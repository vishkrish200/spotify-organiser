const TokenStorage = require("../../src/lib/tokenStorage");
const crypto = require("crypto");
const fs = require("fs").promises;
const os = require("os");
const path = require("path");

// Mock dependencies
jest.mock("keytar", () => ({
  setPassword: jest.fn(),
  getPassword: jest.fn(),
  deletePassword: jest.fn(),
}));

jest.mock("fs", () => ({
  promises: {
    access: jest.fn(),
    readFile: jest.fn(),
    writeFile: jest.fn(),
    unlink: jest.fn(),
    mkdir: jest.fn(),
  },
  constants: {
    F_OK: 0,
  },
}));

jest.mock("os");
jest.mock("path");

const keytar = require("keytar");

describe("TokenStorage", () => {
  let tokenStorage;
  let mockConfigDir;
  let mockConfigFile;

  beforeEach(() => {
    jest.clearAllMocks();

    mockConfigDir = "/home/user/.spotify-organizer";
    mockConfigFile = "/home/user/.spotify-organizer/tokens.json";

    os.homedir.mockReturnValue("/home/user");
    path.join.mockImplementation((...args) => args.join("/"));

    tokenStorage = new TokenStorage();
  });

  describe("Constructor", () => {
    test("should initialize with keytar available", () => {
      // Keytar module is available (mocked)
      expect(tokenStorage.useKeychain).toBe(true);
      expect(tokenStorage.configDir).toBe(mockConfigDir);
      expect(tokenStorage.configFile).toBe(mockConfigFile);
    });

    test("should initialize service name and account", () => {
      expect(tokenStorage.serviceName).toBe("spotify-organizer");
      expect(tokenStorage.accountName).toBe("spotify-tokens");
    });
  });

  describe("generateKey", () => {
    test("should generate consistent key from password and salt", () => {
      const password = "test-password";
      const salt = crypto.randomBytes(32);

      const key1 = tokenStorage.generateKey(password, salt);
      const key2 = tokenStorage.generateKey(password, salt);

      expect(key1).toEqual(key2);
      expect(key1).toHaveLength(32); // 256 bits
    });

    test("should generate different keys for different salts", () => {
      const password = "test-password";
      const salt1 = crypto.randomBytes(32);
      const salt2 = crypto.randomBytes(32);

      const key1 = tokenStorage.generateKey(password, salt1);
      const key2 = tokenStorage.generateKey(password, salt2);

      expect(key1).not.toEqual(key2);
    });
  });

  describe("encrypt", () => {
    test("should encrypt data successfully", () => {
      const data = { accessToken: "test-token", refreshToken: "test-refresh" };
      const password = "test-password";

      const encrypted = tokenStorage.encrypt(JSON.stringify(data), password);

      expect(encrypted).toHaveProperty("salt");
      expect(encrypted).toHaveProperty("iv");
      expect(encrypted).toHaveProperty("data");
      expect(encrypted).toHaveProperty("tag");
      expect(encrypted.salt).toHaveLength(64); // 32 bytes as hex
      expect(encrypted.iv).toHaveLength(24); // 12 bytes as hex
    });

    test("should generate different outputs for same input", () => {
      const data = "same-data";
      const password = "same-password";

      const encrypted1 = tokenStorage.encrypt(data, password);
      const encrypted2 = tokenStorage.encrypt(data, password);

      // Should be different due to random salt and IV
      expect(encrypted1.salt).not.toBe(encrypted2.salt);
      expect(encrypted1.iv).not.toBe(encrypted2.iv);
      expect(encrypted1.data).not.toBe(encrypted2.data);
    });
  });

  describe("decrypt", () => {
    test("should decrypt data successfully", () => {
      const originalData = {
        accessToken: "test-token",
        refreshToken: "test-refresh",
      };
      const password = "test-password";

      const encrypted = tokenStorage.encrypt(
        JSON.stringify(originalData),
        password
      );
      const decrypted = tokenStorage.decrypt(encrypted, password);

      expect(JSON.parse(decrypted)).toEqual(originalData);
    });

    test("should throw error with wrong password", () => {
      const data = "test-data";
      const correctPassword = "correct-password";
      const wrongPassword = "wrong-password";

      const encrypted = tokenStorage.encrypt(data, correctPassword);

      expect(() => {
        tokenStorage.decrypt(encrypted, wrongPassword);
      }).toThrow();
    });

    test("should throw error with corrupted data", () => {
      const data = "test-data";
      const password = "test-password";

      const encrypted = tokenStorage.encrypt(data, password);
      encrypted.data = "corrupted-data";

      expect(() => {
        tokenStorage.decrypt(encrypted, password);
      }).toThrow();
    });
  });

  describe("saveTokens - keychain", () => {
    test("should save tokens to keychain successfully", async () => {
      const tokens = {
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token",
        expiresIn: 3600,
        createdAt: Date.now(),
      };

      keytar.setPassword.mockResolvedValue();

      await tokenStorage.saveTokens(tokens);

      expect(keytar.setPassword).toHaveBeenCalledWith(
        "spotify-organizer",
        "spotify-tokens",
        JSON.stringify(tokens)
      );
    });

    test("should fallback to file storage if keychain fails", async () => {
      const tokens = {
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token",
        expiresIn: 3600,
        createdAt: Date.now(),
      };

      keytar.setPassword.mockRejectedValue(new Error("Keychain error"));
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();

      await tokenStorage.saveTokens(tokens);

      expect(keytar.setPassword).toHaveBeenCalled();
      expect(fs.mkdir).toHaveBeenCalledWith(mockConfigDir, { recursive: true });
      expect(fs.writeFile).toHaveBeenCalled();
    });
  });

  describe("loadTokens - keychain", () => {
    test("should load tokens from keychain successfully", async () => {
      const tokens = {
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token",
        expiresIn: 3600,
        createdAt: Date.now(),
      };

      keytar.getPassword.mockResolvedValue(JSON.stringify(tokens));

      const result = await tokenStorage.loadTokens();

      expect(result).toEqual(tokens);
      expect(keytar.getPassword).toHaveBeenCalledWith(
        "spotify-organizer",
        "spotify-tokens"
      );
    });

    test("should fallback to file storage if keychain fails", async () => {
      const tokens = {
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token",
        expiresIn: 3600,
        createdAt: Date.now(),
      };

      keytar.getPassword.mockRejectedValue(new Error("Keychain error"));
      fs.access.mockResolvedValue();
      fs.readFile.mockResolvedValue(
        JSON.stringify({
          salt: "test-salt",
          iv: "test-iv",
          data: "encrypted-data",
          tag: "test-tag",
        })
      );

      // Mock decrypt to return tokens
      jest
        .spyOn(tokenStorage, "decrypt")
        .mockReturnValue(JSON.stringify(tokens));

      const result = await tokenStorage.loadTokens();

      expect(keytar.getPassword).toHaveBeenCalled();
      expect(fs.readFile).toHaveBeenCalledWith(mockConfigFile, "utf8");
      expect(result).toEqual(tokens);
    });

    test("should return null if no tokens exist", async () => {
      keytar.getPassword.mockResolvedValue(null);

      const result = await tokenStorage.loadTokens();

      expect(result).toBeNull();
    });
  });

  describe("deleteTokens", () => {
    test("should delete tokens from keychain successfully", async () => {
      keytar.deletePassword.mockResolvedValue(true);

      await tokenStorage.deleteTokens();

      expect(keytar.deletePassword).toHaveBeenCalledWith(
        "spotify-organizer",
        "spotify-tokens"
      );
    });

    test("should delete tokens from file storage if keychain fails", async () => {
      keytar.deletePassword.mockRejectedValue(new Error("Keychain error"));
      fs.access.mockResolvedValue();
      fs.unlink.mockResolvedValue();

      await tokenStorage.deleteTokens();

      expect(keytar.deletePassword).toHaveBeenCalled();
      expect(fs.unlink).toHaveBeenCalledWith(mockConfigFile);
    });

    test("should handle file not found gracefully", async () => {
      keytar.deletePassword.mockRejectedValue(new Error("Keychain error"));
      fs.access.mockRejectedValue(new Error("File not found"));

      await expect(tokenStorage.deleteTokens()).resolves.not.toThrow();
    });
  });

  describe("hasValidTokens", () => {
    test('should return "valid" for valid tokens', () => {
      const tokens = {
        accessToken: "test-token",
        refreshToken: "test-refresh",
        expiresIn: 3600,
        createdAt: Date.now() - 1000, // 1 second ago
      };

      const result = tokenStorage.hasValidTokens(tokens);

      expect(result).toBe("valid");
    });

    test('should return "needsRefresh" for expired tokens with refresh token', () => {
      const tokens = {
        accessToken: "test-token",
        refreshToken: "test-refresh",
        expiresIn: 3600,
        createdAt: Date.now() - 7200000, // 2 hours ago
      };

      const result = tokenStorage.hasValidTokens(tokens);

      expect(result).toBe("needsRefresh");
    });

    test('should return "invalid" for expired tokens without refresh token', () => {
      const tokens = {
        accessToken: "test-token",
        expiresIn: 3600,
        createdAt: Date.now() - 7200000, // 2 hours ago
      };

      const result = tokenStorage.hasValidTokens(tokens);

      expect(result).toBe("invalid");
    });

    test('should return "invalid" for null tokens', () => {
      const result = tokenStorage.hasValidTokens(null);

      expect(result).toBe("invalid");
    });

    test('should return "invalid" for incomplete tokens', () => {
      const tokens = {
        accessToken: "test-token",
        // Missing required fields
      };

      const result = tokenStorage.hasValidTokens(tokens);

      expect(result).toBe("invalid");
    });
  });

  describe("getStorageMethod", () => {
    test("should return keychain when available", () => {
      const method = tokenStorage.getStorageMethod();

      expect(method).toBe("System Keychain (secure)");
    });

    test("should return encrypted file when keychain unavailable", () => {
      tokenStorage.useKeychain = false;

      const method = tokenStorage.getStorageMethod();

      expect(method).toBe("Encrypted File (AES-256)");
    });
  });

  describe("file storage methods", () => {
    beforeEach(() => {
      tokenStorage.useKeychain = false; // Force file storage
    });

    test("should save tokens to encrypted file", async () => {
      const tokens = {
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token",
        expiresIn: 3600,
        createdAt: Date.now(),
      };

      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();

      await tokenStorage.saveTokens(tokens);

      expect(fs.mkdir).toHaveBeenCalledWith(mockConfigDir, { recursive: true });
      expect(fs.writeFile).toHaveBeenCalled();

      // Verify encrypted data structure
      const writeCall = fs.writeFile.mock.calls[0];
      const encryptedData = JSON.parse(writeCall[1]);
      expect(encryptedData).toHaveProperty("salt");
      expect(encryptedData).toHaveProperty("iv");
      expect(encryptedData).toHaveProperty("data");
      expect(encryptedData).toHaveProperty("tag");
    });

    test("should load tokens from encrypted file", async () => {
      const tokens = {
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token",
        expiresIn: 3600,
        createdAt: Date.now(),
      };

      // Create real encrypted data
      const encrypted = tokenStorage.encrypt(
        JSON.stringify(tokens),
        "machine-id"
      );

      fs.access.mockResolvedValue();
      fs.readFile.mockResolvedValue(JSON.stringify(encrypted));

      const result = await tokenStorage.loadTokens();

      expect(result).toEqual(tokens);
    });
  });
});
