/**
 * Secure Token Storage Module
 *
 * Implements hybrid storage approach:
 * 1. Primary: System keychain via keytar (macOS Keychain, Windows Credential Manager, Linux Secret Service)
 * 2. Fallback: AES-256 encrypted file storage with user passphrase
 */

const crypto = require("crypto");
const fs = require("fs").promises;
const path = require("path");
const os = require("os");
const chalk = require("chalk");

class TokenStorage {
  constructor() {
    this.SERVICE_NAME = "spotify-organizer";
    this.ACCOUNT_NAME = "oauth-tokens";
    this.configDir = path.join(os.homedir(), ".spotify-organizer");
    this.configPath = path.join(this.configDir, "tokens.enc");
    this.saltPath = path.join(this.configDir, "salt");
    this.metaPath = path.join(this.configDir, "meta.json");

    this.keytar = null;
    this.keytarAvailable = false;

    this.initializeKeytar();
  }

  /**
   * Initialize keytar with error handling
   */
  initializeKeytar() {
    try {
      this.keytar = require("keytar");
      this.keytarAvailable = true;
      console.log(chalk.gray("🔐 System keychain available"));
    } catch (error) {
      console.log(
        chalk.yellow(
          "⚠️  System keychain not available, using encrypted file storage"
        )
      );
      this.keytarAvailable = false;
    }
  }

  /**
   * Save tokens securely using the best available method
   */
  async saveTokens(tokenData) {
    const tokenObj = {
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      expiresIn: tokenData.expiresIn,
      tokenType: tokenData.tokenType || "Bearer",
      expiresAt: Date.now() + tokenData.expiresIn * 1000,
      createdAt: Date.now(),
    };

    if (this.keytarAvailable) {
      return await this.saveToKeychain(tokenObj);
    } else {
      return await this.saveToEncryptedFile(tokenObj);
    }
  }

  /**
   * Load tokens using the best available method
   */
  async loadTokens() {
    if (this.keytarAvailable) {
      return await this.loadFromKeychain();
    } else {
      return await this.loadFromEncryptedFile();
    }
  }

  /**
   * Delete stored tokens
   */
  async deleteTokens() {
    if (this.keytarAvailable) {
      return await this.deleteFromKeychain();
    } else {
      return await this.deleteFromEncryptedFile();
    }
  }

  /**
   * Check if tokens exist and are valid
   */
  async hasValidTokens() {
    try {
      const tokens = await this.loadTokens();
      if (!tokens) return false;

      // Check if access token is expired (with 5 minute buffer)
      const now = Date.now();
      const bufferTime = 5 * 60 * 1000; // 5 minutes

      if (tokens.expiresAt && now + bufferTime >= tokens.expiresAt) {
        console.log(chalk.yellow("🔄 Access token expired, will need refresh"));
        return { valid: false, needsRefresh: true, tokens };
      }

      return { valid: true, needsRefresh: false, tokens };
    } catch (error) {
      return { valid: false, needsRefresh: false, error: error.message };
    }
  }

  // ========================================
  // System Keychain Methods (keytar)
  // ========================================

  /**
   * Save tokens to system keychain
   */
  async saveToKeychain(tokenObj) {
    try {
      await this.keytar.setPassword(
        this.SERVICE_NAME,
        this.ACCOUNT_NAME,
        JSON.stringify(tokenObj)
      );

      // Save metadata to track storage method
      await this.saveMetadata({ method: "keychain", lastUpdated: Date.now() });

      console.log(chalk.green("✅ Tokens saved to system keychain"));
      return { success: true, method: "keychain" };
    } catch (error) {
      console.log(chalk.red(`❌ Failed to save to keychain: ${error.message}`));
      throw error;
    }
  }

  /**
   * Load tokens from system keychain
   */
  async loadFromKeychain() {
    try {
      const tokenData = await this.keytar.getPassword(
        this.SERVICE_NAME,
        this.ACCOUNT_NAME
      );
      if (!tokenData) return null;

      return JSON.parse(tokenData);
    } catch (error) {
      console.log(
        chalk.red(`❌ Failed to load from keychain: ${error.message}`)
      );
      return null;
    }
  }

  /**
   * Delete tokens from system keychain
   */
  async deleteFromKeychain() {
    try {
      await this.keytar.deletePassword(this.SERVICE_NAME, this.ACCOUNT_NAME);
      await this.deleteMetadata();
      console.log(chalk.green("✅ Tokens deleted from system keychain"));
      return { success: true };
    } catch (error) {
      console.log(
        chalk.red(`❌ Failed to delete from keychain: ${error.message}`)
      );
      throw error;
    }
  }

  // ========================================
  // AES-256 Encrypted File Methods
  // ========================================

  /**
   * Save tokens to encrypted file
   */
  async saveToEncryptedFile(tokenObj) {
    try {
      await this.ensureConfigDir();

      // Get or create encryption key
      const key = await this.getEncryptionKey();

      // Encrypt the token data
      const encrypted = this.encrypt(tokenObj, key);

      // Save encrypted data
      await fs.writeFile(this.configPath, JSON.stringify(encrypted), "utf8");

      // Save metadata
      await this.saveMetadata({
        method: "encrypted-file",
        lastUpdated: Date.now(),
      });

      console.log(chalk.green("✅ Tokens saved to encrypted file"));
      return { success: true, method: "encrypted-file" };
    } catch (error) {
      console.log(
        chalk.red(`❌ Failed to save to encrypted file: ${error.message}`)
      );
      throw error;
    }
  }

  /**
   * Load tokens from encrypted file
   */
  async loadFromEncryptedFile() {
    try {
      // Check if encrypted file exists
      try {
        await fs.access(this.configPath);
      } catch {
        return null; // File doesn't exist
      }

      // Get encryption key
      const key = await this.getEncryptionKey();

      // Read and decrypt
      const encryptedData = await fs.readFile(this.configPath, "utf8");
      const parsed = JSON.parse(encryptedData);

      return this.decrypt(parsed, key);
    } catch (error) {
      console.log(
        chalk.red(`❌ Failed to load from encrypted file: ${error.message}`)
      );
      return null;
    }
  }

  /**
   * Delete encrypted file and related data
   */
  async deleteFromEncryptedFile() {
    try {
      // Delete all related files
      const filesToDelete = [this.configPath, this.saltPath, this.metaPath];

      for (const filePath of filesToDelete) {
        try {
          await fs.unlink(filePath);
        } catch (error) {
          // Ignore if file doesn't exist
          if (error.code !== "ENOENT") {
            console.log(
              chalk.yellow(`⚠️  Could not delete ${filePath}: ${error.message}`)
            );
          }
        }
      }

      console.log(chalk.green("✅ Tokens and encryption data deleted"));
      return { success: true };
    } catch (error) {
      console.log(
        chalk.red(`❌ Failed to delete encrypted data: ${error.message}`)
      );
      throw error;
    }
  }

  // ========================================
  // Encryption Helper Methods
  // ========================================

  /**
   * Get or create encryption key from user passphrase
   */
  async getEncryptionKey() {
    let salt;

    // Try to load existing salt
    try {
      const saltData = await fs.readFile(this.saltPath, "utf8");
      salt = Buffer.from(saltData, "hex");
    } catch {
      // Generate new salt
      salt = crypto.randomBytes(32);
      await fs.writeFile(this.saltPath, salt.toString("hex"), "utf8");
      console.log(chalk.blue("🔑 New encryption salt generated"));
    }

    // For this implementation, we'll use a fixed passphrase derivation
    // In a real app, you'd prompt the user for a passphrase
    const passphrase = this.getSystemPassphrase();

    // Derive key using PBKDF2
    return crypto.pbkdf2Sync(passphrase, salt, 100000, 32, "sha256");
  }

  /**
   * Generate a system-specific passphrase (not ideal, but better than hardcoded)
   */
  getSystemPassphrase() {
    // This is a compromise - derive from system info
    // In production, you'd prompt user for passphrase
    const systemInfo = `${os.hostname()}-${os.userInfo().username}-${
      this.SERVICE_NAME
    }`;
    return crypto.createHash("sha256").update(systemInfo).digest("hex");
  }

  /**
   * Encrypt data using AES-256-GCM
   */
  encrypt(data, key) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

    let encrypted = cipher.update(JSON.stringify(data), "utf8", "hex");
    encrypted += cipher.final("hex");

    const tag = cipher.getAuthTag();

    return {
      iv: iv.toString("hex"),
      encrypted,
      tag: tag.toString("hex"),
    };
  }

  /**
   * Decrypt data using AES-256-GCM
   */
  decrypt({ iv, encrypted, tag }, key) {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(iv, "hex")
    );
    decipher.setAuthTag(Buffer.from(tag, "hex"));

    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return JSON.parse(decrypted);
  }

  // ========================================
  // Utility Methods
  // ========================================

  /**
   * Ensure config directory exists
   */
  async ensureConfigDir() {
    try {
      await fs.access(this.configDir);
    } catch {
      await fs.mkdir(this.configDir, { recursive: true });
      console.log(chalk.blue(`📁 Created config directory: ${this.configDir}`));
    }
  }

  /**
   * Save metadata about storage method
   */
  async saveMetadata(meta) {
    try {
      await this.ensureConfigDir();
      await fs.writeFile(this.metaPath, JSON.stringify(meta, null, 2), "utf8");
    } catch (error) {
      // Non-critical error
      console.log(chalk.gray(`⚠️  Could not save metadata: ${error.message}`));
    }
  }

  /**
   * Delete metadata file
   */
  async deleteMetadata() {
    try {
      await fs.unlink(this.metaPath);
    } catch {
      // Ignore if file doesn't exist
    }
  }

  /**
   * Get storage method info
   */
  getStorageInfo() {
    return {
      keytarAvailable: this.keytarAvailable,
      preferredMethod: this.keytarAvailable ? "keychain" : "encrypted-file",
      configDir: this.configDir,
    };
  }
}

module.exports = TokenStorage;
