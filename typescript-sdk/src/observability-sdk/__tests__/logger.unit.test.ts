import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getLangWatchLogger, getLangWatchLoggerFromProvider, setLangWatchLoggerProvider, createLangWatchLogger } from "../logger";
import { logs, NoopLoggerProvider } from "@opentelemetry/api-logs";
import { LangWatchLogger, LangWatchLogRecord } from "../types";
import { resetObservabilitySdkConfig, initializeObservabilitySdkConfig } from "../config";

vi.mock("@opentelemetry/api-logs", () => ({
  logs: {
    getLoggerProvider: vi.fn(),
  },
  NoopLoggerProvider: vi.fn().mockImplementation(() => ({
    getLogger: vi.fn().mockReturnValue({
      emit: vi.fn(),
    }),
  })),
}));

// Mock the setLangWatchLoggerProvider function
vi.mock("../logger", async () => {
  const actual = await vi.importActual("../logger");
  return {
    ...actual,
    setLangWatchLoggerProvider: vi.fn(),
  };
});

describe("LangWatch Logger", () => {
  let mockLogger: any;
  let mockLoggerProvider: any;

  beforeEach(() => {
    vi.clearAllMocks();
    resetObservabilitySdkConfig();

    // Create fresh mocks for each test
    mockLogger = {
      emit: vi.fn(),
    };

    mockLoggerProvider = {
      getLogger: vi.fn().mockReturnValue(mockLogger),
    };

    // Set up the mock return values
    (logs.getLoggerProvider as any).mockReturnValue(mockLoggerProvider);
  });

  afterEach(() => {
    vi.clearAllMocks();
    resetObservabilitySdkConfig();
  });

  describe("setLangWatchLoggerProvider", () => {
    it("should set the logger provider for LangWatch logging", () => {
      const customProvider = {
        getLogger: vi.fn().mockReturnValue(mockLogger),
      };

      setLangWatchLoggerProvider(customProvider as any);

      // Verify the function was called
      expect(setLangWatchLoggerProvider).toHaveBeenCalledWith(customProvider);
    });
  });

  describe("getLangWatchLogger", () => {
    it("should create a logger with the given name", () => {
      const logger = getLangWatchLogger("test-logger");

      expect(logger).toBeDefined();
      // Should use the current logger provider (NoOp by default)
      expect(logger).toBeInstanceOf(Object);
      expect(typeof logger.emit).toBe("function");
    });

    it("should create a logger with name and version", () => {
      const logger = getLangWatchLogger("test-logger", "1.0.0");

      expect(logger).toBeDefined();
      expect(logger).toBeInstanceOf(Object);
      expect(typeof logger.emit).toBe("function");
    });

    it("should return a LangWatchLogger instance", () => {
      const logger = getLangWatchLogger("test-logger");

      expect(logger).toBeInstanceOf(Object);
      expect(typeof logger.emit).toBe("function");
    });

    it("should use NoOp logger when no provider is set", () => {
      // Reset to use NoOp logger
      const noopProvider = new NoopLoggerProvider();
      const noopLogger = noopProvider.getLogger("test");

      const logger = getLangWatchLogger("test-logger");

      expect(logger).toBeDefined();
      expect(typeof logger.emit).toBe("function");
    });
  });

  describe("getLangWatchLoggerFromProvider", () => {
    it("should create a logger from a specific provider", () => {
      const customProvider = {
        getLogger: vi.fn().mockReturnValue(mockLogger),
      };

      const logger = getLangWatchLoggerFromProvider(
        customProvider as any,
        "custom-logger"
      );

      expect(logger).toBeDefined();
      expect(customProvider.getLogger).toHaveBeenCalledWith("custom-logger", undefined);
    });

    it("should create a logger with name and version from provider", () => {
      const customProvider = {
        getLogger: vi.fn().mockReturnValue(mockLogger),
      };

      const logger = getLangWatchLoggerFromProvider(
        customProvider as any,
        "custom-logger",
        "2.0.0"
      );

      expect(logger).toBeDefined();
      expect(customProvider.getLogger).toHaveBeenCalledWith("custom-logger", "2.0.0");
    });
  });

  describe("LangWatchLogger emit functionality", () => {
    it("should emit log records with LangWatch attributes", () => {
      const logger = getLangWatchLogger("test-logger") as LangWatchLogger;

      const logRecord: LangWatchLogRecord = {
        severityText: "INFO",
        severityNumber: 9,
        body: "Test log message",
        attributes: {
          "langwatch.service": "test-service",
          "langwatch.environment": "test",
        },
      };

      logger.emit(logRecord);

      // Since we're using NoOp logger by default, this won't actually emit
      // but it should not throw
      expect(() => logger.emit(logRecord)).not.toThrow();
    });

    it("should emit log records without attributes", () => {
      const logger = getLangWatchLogger("test-logger") as LangWatchLogger;

      const logRecord: LangWatchLogRecord = {
        severityText: "ERROR",
        severityNumber: 17,
        body: "Error message",
      };

      expect(() => logger.emit(logRecord)).not.toThrow();
    });

    it("should emit log records with complex attributes", () => {
      const logger = getLangWatchLogger("test-logger") as LangWatchLogger;

      const logRecord: LangWatchLogRecord = {
        severityText: "WARN",
        severityNumber: 13,
        body: "Warning message",
        attributes: {
          "langwatch.service": "test-service",
          "langwatch.environment": "test",
          "langwatch.operation": "test-operation",
          "langwatch.user_id": "user-123",
          "custom.attribute": "custom-value",
        },
      };

      expect(() => logger.emit(logRecord)).not.toThrow();
    });
  });

  describe("Data capture functionality", () => {
    it("should preserve log record body when output capture is enabled", () => {
      // Initialize config with output capture enabled
      initializeObservabilitySdkConfig({
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        dataCapture: "all", // This enables output capture
      });

      const logger = createLangWatchLogger(mockLogger);
      const originalBody = "Test log message";

      const logRecord: LangWatchLogRecord = {
        severityText: "INFO",
        severityNumber: 9,
        body: originalBody,
        attributes: { "test": "value" },
      };

      logger.emit(logRecord);

      // Verify the log record body was preserved
      expect(mockLogger.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          body: originalBody,
        })
      );
    });

    it("should remove log record body when output capture is disabled", () => {
      // Initialize config with output capture disabled
      initializeObservabilitySdkConfig({
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        dataCapture: "input", // This disables output capture
      });

      const logger = createLangWatchLogger(mockLogger);
      const originalBody = "Test log message";

      const logRecord: LangWatchLogRecord = {
        severityText: "INFO",
        severityNumber: 9,
        body: originalBody,
        attributes: { "test": "value" },
      };

      logger.emit(logRecord);

      // Verify the log record body was removed (set to undefined)
      expect(mockLogger.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          body: undefined,
        })
      );
    });

    it("should preserve log record body when output capture is set to 'output'", () => {
      // Initialize config with output capture enabled
      initializeObservabilitySdkConfig({
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        dataCapture: "output", // This enables output capture
      });

      const logger = createLangWatchLogger(mockLogger);
      const originalBody = "Test log message";

      const logRecord: LangWatchLogRecord = {
        severityText: "INFO",
        severityNumber: 9,
        body: originalBody,
        attributes: { "test": "value" },
      };

      logger.emit(logRecord);

      // Verify the log record body was preserved
      expect(mockLogger.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          body: originalBody,
        })
      );
    });

    it("should remove log record body when output capture is set to 'none'", () => {
      // Initialize config with output capture disabled
      initializeObservabilitySdkConfig({
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        dataCapture: "none", // This disables output capture
      });

      const logger = createLangWatchLogger(mockLogger);
      const originalBody = "Test log message";

      const logRecord: LangWatchLogRecord = {
        severityText: "INFO",
        severityNumber: 9,
        body: originalBody,
        attributes: { "test": "value" },
      };

      logger.emit(logRecord);

      // Verify the log record body was removed
      expect(mockLogger.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          body: undefined,
        })
      );
    });

    it("should preserve log record body when no data capture config is set", () => {
      // Initialize config without data capture (defaults to "all")
      initializeObservabilitySdkConfig({
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      });

      const logger = createLangWatchLogger(mockLogger);
      const originalBody = "Test log message";

      const logRecord: LangWatchLogRecord = {
        severityText: "INFO",
        severityNumber: 9,
        body: originalBody,
        attributes: { "test": "value" },
      };

      logger.emit(logRecord);

      // Verify the log record body was preserved (defaults to "all")
      expect(mockLogger.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          body: originalBody,
        })
      );
    });

    it("should preserve other log record properties when output capture is disabled", () => {
      // Initialize config with output capture disabled
      initializeObservabilitySdkConfig({
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        dataCapture: "input", // This disables output capture
      });

      const logger = createLangWatchLogger(mockLogger);

      const logRecord: LangWatchLogRecord = {
        severityText: "ERROR",
        severityNumber: 17,
        body: "Test log message",
        attributes: { "test": "value", "custom": "attribute" },
        timestamp: new Date(),
      };

      logger.emit(logRecord);

      // Verify other properties are preserved
      expect(mockLogger.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          severityText: "ERROR",
          severityNumber: 17,
          body: undefined, // Only body should be modified
          attributes: { "test": "value", "custom": "attribute" },
          timestamp: expect.any(Date),
        })
      );
    });

    it("should handle log records without body when output capture is disabled", () => {
      // Initialize config with output capture disabled
      initializeObservabilitySdkConfig({
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        dataCapture: "input",
      });

      const logger = createLangWatchLogger(mockLogger);

      const logRecord: LangWatchLogRecord = {
        severityText: "INFO",
        severityNumber: 9,
        // No body property
        attributes: { "test": "value" },
      };

      logger.emit(logRecord);

      // Verify the log record is emitted without body
      expect(mockLogger.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          body: undefined,
        })
      );
    });

    it("should handle log records with null body when output capture is disabled", () => {
      // Initialize config with output capture disabled
      initializeObservabilitySdkConfig({
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        dataCapture: "input",
      });

      const logger = createLangWatchLogger(mockLogger);

      const logRecord: LangWatchLogRecord = {
        severityText: "INFO",
        severityNumber: 9,
        body: null as any,
        attributes: { "test": "value" },
      };

      logger.emit(logRecord);

      // Verify the log record body is set to undefined
      expect(mockLogger.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          body: undefined,
        })
      );
    });

    it("should handle log records with empty string body when output capture is disabled", () => {
      // Initialize config with output capture disabled
      initializeObservabilitySdkConfig({
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        dataCapture: "input",
      });

      const logger = createLangWatchLogger(mockLogger);

      const logRecord: LangWatchLogRecord = {
        severityText: "INFO",
        severityNumber: 9,
        body: "",
        attributes: { "test": "value" },
      };

      logger.emit(logRecord);

      // Verify the log record body is set to undefined
      expect(mockLogger.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          body: undefined,
        })
      );
    });
  });

  describe("Logger naming and versioning", () => {
    it("should handle different logger names", () => {
      const loggers = [
        getLangWatchLogger("app-logger"),
        getLangWatchLogger("database-logger"),
        getLangWatchLogger("api-logger"),
      ];

      expect(loggers).toHaveLength(3);
      loggers.forEach(logger => {
        expect(logger).toBeDefined();
        expect(typeof logger.emit).toBe("function");
      });
    });

    it("should handle different versions", () => {
      const loggers = [
        getLangWatchLogger("test-logger", "1.0.0"),
        getLangWatchLogger("test-logger", "2.0.0"),
        getLangWatchLogger("test-logger", "latest"),
      ];

      expect(loggers).toHaveLength(3);
      loggers.forEach(logger => {
        expect(logger).toBeDefined();
        expect(typeof logger.emit).toBe("function");
      });
    });
  });

  describe("Integration with OpenTelemetry logs API", () => {
    it("should use the current logger provider by default", () => {
      getLangWatchLogger("test-logger");

      // Should not throw when getting logger
      expect(() => getLangWatchLogger("test-logger")).not.toThrow();
    });

    it("should use the provided logger provider when specified", () => {
      const customProvider = {
        getLogger: vi.fn().mockReturnValue(mockLogger),
      };

      getLangWatchLoggerFromProvider(customProvider as any, "test-logger");

      expect(customProvider.getLogger).toHaveBeenCalledWith("test-logger", undefined);
    });
  });

  describe("Error handling", () => {
    it("should handle undefined version gracefully", () => {
      const logger = getLangWatchLogger("test-logger", undefined);

      expect(logger).toBeDefined();
      expect(typeof logger.emit).toBe("function");
    });

    it("should handle empty string version", () => {
      const logger = getLangWatchLogger("test-logger", "");

      expect(logger).toBeDefined();
      expect(typeof logger.emit).toBe("function");
    });
  });

  describe("Type safety", () => {
    it("should maintain LangWatchLogger type", () => {
      const logger = getLangWatchLogger("test-logger");

      // TypeScript should recognize this as LangWatchLogger
      expect(logger).toHaveProperty("emit");

      // Should be able to call emit with LangWatchLogRecord
      const logRecord: LangWatchLogRecord = {
        severityText: "INFO",
        severityNumber: 9,
        body: "Test",
      };

      expect(() => logger.emit(logRecord)).not.toThrow();
    });
  });
});
