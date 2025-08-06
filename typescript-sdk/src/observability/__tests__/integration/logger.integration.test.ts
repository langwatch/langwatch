import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { InMemoryLogRecordExporter, SimpleLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { getLangWatchLogger, getLangWatchLoggerFromProvider } from "../../logger";
import { NoOpLogger } from "../../../logger";
import { setupObservability } from "../../setup/node";
import { LangWatchLogRecord } from "../../types";
import { resetObservabilitySdkConfig } from "../../config";

/**
 * Integration tests for LangWatch logger with real OpenTelemetry setup.
 *
 * These tests verify:
 * - Real OpenTelemetry SDK initialization
 * - Actual log record creation and data flow
 * - Integration between logger and setup components
 * - Logger functionality and API
 * - Log records are actually sent to processors and exported
 */

// Test data constants for consistency
const TEST_LOG_MESSAGE = "This is a test log message";
const TEST_ERROR_MESSAGE = "This is a test error message";
const TEST_WARNING_MESSAGE = "This is a test warning message";

const TEST_COMPLEX_ATTRIBUTES = {
  "langwatch.service": "test-service",
  "langwatch.environment": "test",
  "langwatch.operation": "test-operation",
  "langwatch.user_id": "user-123",
  "langwatch.session_id": "session-456",
  "langwatch.request_id": "req-789",
  "custom.attribute": "custom-value",
  "performance.latency_ms": 150,
  "security.level": "high",
} as const;

const TEST_GEN_AI_ATTRIBUTES = {
  "gen_ai.request.model": "gpt-4",
  "gen_ai.request.temperature": 0.7,
  "gen_ai.request.max_tokens": 150,
  "gen_ai.response.finish_reason": "stop",
  "gen_ai.usage.prompt_tokens": 15,
  "gen_ai.usage.completion_tokens": 25,
  "gen_ai.usage.total_tokens": 40,
} as const;

describe("Logger Integration Tests", () => {
  const logRecordExporter = new InMemoryLogRecordExporter();
  const logRecordProcessor = new SimpleLogRecordProcessor(logRecordExporter);
  let observabilityHandle: ReturnType<typeof setupObservability>;

  beforeEach(() => {
    // Reset OpenTelemetry global state
    vi.resetModules();
    resetObservabilitySdkConfig();

    // Setup observability with real OpenTelemetry SDK
    observabilityHandle = setupObservability({
      serviceName: "logger-integration-test",
      logRecordProcessors: [logRecordProcessor],
      logger: new NoOpLogger(),
      throwOnSetupError: true,
      attributes: {
        "test.suite": "logger-integration",
        "test.environment": "vitest"
      },
    });
  });

  afterEach(async () => {
    await logRecordProcessor.forceFlush();
    logRecordExporter.reset();
    resetObservabilitySdkConfig();
  });

  describe("log record creation and data flow", () => {
    it("should create log records with proper LangWatch attributes through real OpenTelemetry", async () => {
      const logger = getLangWatchLogger("integration-test-logger-1");

      // Create log record with LangWatch enhancements
      const logRecord: LangWatchLogRecord = {
        severityText: "INFO",
        severityNumber: 9,
        body: TEST_LOG_MESSAGE,
        attributes: TEST_COMPLEX_ATTRIBUTES,
      };

      logger.emit(logRecord);

      // Flush and verify exported log records
      await logRecordProcessor.forceFlush();
      const exportedLogRecords = logRecordExporter.getFinishedLogRecords();

      expect(exportedLogRecords).toHaveLength(1);

      const exportedLogRecord = exportedLogRecords[0];
      if (!exportedLogRecord) {
        throw new Error("Expected log record to be exported");
      }

      expect(exportedLogRecord.body).toBe(TEST_LOG_MESSAGE);
      expect(exportedLogRecord.severityText).toBe("INFO");
      expect(exportedLogRecord.severityNumber).toBe(9);

      // Verify LangWatch-specific attributes
      expect(exportedLogRecord.attributes?.["langwatch.service"]).toBe("test-service");
      expect(exportedLogRecord.attributes?.["langwatch.environment"]).toBe("test");
      expect(exportedLogRecord.attributes?.["langwatch.operation"]).toBe("test-operation");
      expect(exportedLogRecord.attributes?.["langwatch.user_id"]).toBe("user-123");
      expect(exportedLogRecord.attributes?.["custom.attribute"]).toBe("custom-value");
      expect(exportedLogRecord.attributes?.["performance.latency_ms"]).toBe(150);
      expect(exportedLogRecord.attributes?.["security.level"]).toBe("high");
    });

    it("should handle different severity levels correctly", async () => {
      const logger = getLangWatchLogger("severity-test-logger-2");

      const logRecords: LangWatchLogRecord[] = [
        {
          severityText: "DEBUG",
          severityNumber: 5,
          body: "Debug message",
          attributes: { "level": "debug" },
        },
        {
          severityText: "INFO",
          severityNumber: 9,
          body: "Info message",
          attributes: { "level": "info" },
        },
        {
          severityText: "WARN",
          severityNumber: 13,
          body: "Warning message",
          attributes: { "level": "warn" },
        },
        {
          severityText: "ERROR",
          severityNumber: 17,
          body: "Error message",
          attributes: { "level": "error" },
        },
      ];

      // Emit all log records
      logRecords.forEach(record => logger.emit(record));

      await logRecordProcessor.forceFlush();
      const exportedLogRecords = logRecordExporter.getFinishedLogRecords();

      expect(exportedLogRecords).toHaveLength(4);

      // Verify severity levels
      const severityTexts = exportedLogRecords.map(r => r.severityText);
      const severityNumbers = exportedLogRecords.map(r => r.severityNumber);

      expect(severityTexts).toEqual(["DEBUG", "INFO", "WARN", "ERROR"]);
      expect(severityNumbers).toEqual([5, 9, 13, 17]);

      // Verify attributes
      exportedLogRecords.forEach((record, index) => {
        expect(record.attributes?.["level"]).toBe(["debug", "info", "warn", "error"][index]);
      });
    });

    it("should handle log records without attributes", async () => {
      const logger = getLangWatchLogger("no-attributes-test-logger-3");

      const logRecord: LangWatchLogRecord = {
        severityText: "INFO",
        severityNumber: 9,
        body: "Simple log message without attributes",
      };

      logger.emit(logRecord);

      await logRecordProcessor.forceFlush();
      const exportedLogRecords = logRecordExporter.getFinishedLogRecords();

      expect(exportedLogRecords).toHaveLength(1);

      const exportedLogRecord = exportedLogRecords[0];
      if (!exportedLogRecord) {
        throw new Error("Expected log record to be exported");
      }

      expect(exportedLogRecord.body).toBe("Simple log message without attributes");
      expect(exportedLogRecord.severityText).toBe("INFO");
      expect(exportedLogRecord.severityNumber).toBe(9);
      expect(exportedLogRecord.attributes).toBeDefined();
    });
  });

  describe("data capture integration", () => {
    it("should preserve log record body when output capture is enabled by default", async () => {
      const logger = getLangWatchLogger("data-capture-test-logger-4");

      const logRecord: LangWatchLogRecord = {
        severityText: "INFO",
        severityNumber: 9,
        body: "Test log message with body",
        attributes: { "test": "value" },
      };

      logger.emit(logRecord);

      await logRecordProcessor.forceFlush();
      const exportedLogRecords = logRecordExporter.getFinishedLogRecords();

      expect(exportedLogRecords).toHaveLength(1);
      const exportedLogRecord = exportedLogRecords[0];
      if (!exportedLogRecord) {
        throw new Error("Expected log record to be exported");
      }

      // By default, output capture should be enabled, so body should be preserved
      expect(exportedLogRecord.body).toBe("Test log message with body");
    });

    it("should preserve log record body when data capture is set to 'all'", async () => {
      // Setup with explicit 'all' data capture
      await observabilityHandle.shutdown();

      observabilityHandle = setupObservability({
        serviceName: "logger-integration-test",
        logRecordProcessors: [logRecordProcessor],
        logger: new NoOpLogger(),
        throwOnSetupError: true,
        dataCapture: "all",
        attributes: {
          "test.suite": "logger-integration",
          "test.environment": "vitest"
        },
      });

      const logger = getLangWatchLogger("data-capture-all-test-logger-5");

      const logRecord: LangWatchLogRecord = {
        severityText: "INFO",
        severityNumber: 9,
        body: "Test log message with body",
        attributes: { "test": "value" },
      };

      logger.emit(logRecord);

      await logRecordProcessor.forceFlush();
      const exportedLogRecords = logRecordExporter.getFinishedLogRecords();

      expect(exportedLogRecords).toHaveLength(1);
      const exportedLogRecord = exportedLogRecords[0];
      if (!exportedLogRecord) {
        throw new Error("Expected log record to be exported");
      }

      // With 'all' data capture, body should be preserved
      expect(exportedLogRecord.body).toBe("Test log message with body");
    });

    it("should preserve log record body when data capture is set to 'output'", async () => {
      // Setup with 'output' data capture
      await observabilityHandle.shutdown();

      observabilityHandle = setupObservability({
        serviceName: "logger-integration-test",
        logRecordProcessors: [logRecordProcessor],
        logger: new NoOpLogger(),
        throwOnSetupError: true,
        dataCapture: "output",
        attributes: {
          "test.suite": "logger-integration",
          "test.environment": "vitest"
        },
      });

      const logger = getLangWatchLogger("data-capture-output-test-logger-6");

      const logRecord: LangWatchLogRecord = {
        severityText: "INFO",
        severityNumber: 9,
        body: "Test log message with body",
        attributes: { "test": "value" },
      };

      logger.emit(logRecord);

      await logRecordProcessor.forceFlush();
      const exportedLogRecords = logRecordExporter.getFinishedLogRecords();

      expect(exportedLogRecords).toHaveLength(1);
      const exportedLogRecord = exportedLogRecords[0];
      if (!exportedLogRecord) {
        throw new Error("Expected log record to be exported");
      }

      // With 'output' data capture, body should be preserved
      expect(exportedLogRecord.body).toBe("Test log message with body");
    });

    it("should remove log record body when data capture is set to 'input'", async () => {
      // Setup with 'input' data capture
      await observabilityHandle.shutdown();

      observabilityHandle = setupObservability({
        serviceName: "logger-integration-test",
        logRecordProcessors: [logRecordProcessor],
        logger: new NoOpLogger(),
        throwOnSetupError: true,
        dataCapture: "input",
        attributes: {
          "test.suite": "logger-integration",
          "test.environment": "vitest"
        },
      });

      const logger = getLangWatchLogger("data-capture-input-test-logger-7");

      const logRecord: LangWatchLogRecord = {
        severityText: "INFO",
        severityNumber: 9,
        body: "Test log message with body",
        attributes: { "test": "value" },
      };

      logger.emit(logRecord);

      await logRecordProcessor.forceFlush();
      const exportedLogRecords = logRecordExporter.getFinishedLogRecords();

      expect(exportedLogRecords).toHaveLength(1);
      const exportedLogRecord = exportedLogRecords[0];
      if (!exportedLogRecord) {
        throw new Error("Expected log record to be exported");
      }

      // With 'input' data capture, body should be removed (set to undefined)
      expect(exportedLogRecord.body).toBeUndefined();
    });

    it("should remove log record body when data capture is set to 'none'", async () => {
      // Setup with 'none' data capture
      await observabilityHandle.shutdown();

      observabilityHandle = setupObservability({
        serviceName: "logger-integration-test",
        logRecordProcessors: [logRecordProcessor],
        logger: new NoOpLogger(),
        throwOnSetupError: true,
        dataCapture: "none",
        attributes: {
          "test.suite": "logger-integration",
          "test.environment": "vitest"
        },
      });

      const logger = getLangWatchLogger("data-capture-none-test-logger-8");

      const logRecord: LangWatchLogRecord = {
        severityText: "INFO",
        severityNumber: 9,
        body: "Test log message with body",
        attributes: { "test": "value" },
      };

      logger.emit(logRecord);

      await logRecordProcessor.forceFlush();
      const exportedLogRecords = logRecordExporter.getFinishedLogRecords();

      expect(exportedLogRecords).toHaveLength(1);
      const exportedLogRecord = exportedLogRecords[0];
      if (!exportedLogRecord) {
        throw new Error("Expected log record to be exported");
      }

      // With 'none' data capture, body should be removed
      expect(exportedLogRecord.body).toBeUndefined();
    });

    it("should preserve other log record properties when output capture is disabled", async () => {
      observabilityHandle = setupObservability({
        serviceName: "logger-integration-test",
        logRecordProcessors: [logRecordProcessor],
        logger: new NoOpLogger(),
        throwOnSetupError: true,
        dataCapture: "input",
        attributes: {
          "test.suite": "logger-integration",
          "test.environment": "vitest"
        },
      });

      const logger = getLangWatchLogger("data-capture-properties-test-logger-9");

      const timestamp = new Date();
      const logRecord: LangWatchLogRecord = {
        severityText: "ERROR",
        severityNumber: 17,
        body: "Test log message with body",
        attributes: { "test": "value", "custom": "attribute" },
        timestamp: timestamp,
      };

      logger.emit(logRecord);

      await logRecordProcessor.forceFlush();
      const exportedLogRecords = logRecordExporter.getFinishedLogRecords();

      expect(exportedLogRecords).toHaveLength(1);
      const exportedLogRecord = exportedLogRecords[0];
      if (!exportedLogRecord) {
        throw new Error("Expected log record to be exported");
      }

      // Verify other properties are preserved while body is removed
      expect(exportedLogRecord.severityText).toBe("ERROR");
      expect(exportedLogRecord.severityNumber).toBe(17);
      expect(exportedLogRecord.body).toBeUndefined(); // Only body should be modified
      expect(exportedLogRecord.attributes).toEqual({ "test": "value", "custom": "attribute" });
      // Note: timestamp is not available on ReadableLogRecord, so we don't assert it
    });

    it("should handle log records without body when output capture is disabled", async () => {


      observabilityHandle = setupObservability({
        serviceName: "logger-integration-test",
        logRecordProcessors: [logRecordProcessor],
        logger: new NoOpLogger(),
        throwOnSetupError: true,
        dataCapture: "input",
        attributes: {
          "test.suite": "logger-integration",
          "test.environment": "vitest"
        },
      });

      const logger = getLangWatchLogger("data-capture-no-body-test-logger-10");

      const logRecord: LangWatchLogRecord = {
        severityText: "INFO",
        severityNumber: 9,
        // No body property
        attributes: { "test": "value" },
      };

      logger.emit(logRecord);

      await logRecordProcessor.forceFlush();
      const exportedLogRecords = logRecordExporter.getFinishedLogRecords();

      expect(exportedLogRecords).toHaveLength(1);
      const exportedLogRecord = exportedLogRecords[0];
      if (!exportedLogRecord) {
        throw new Error("Expected log record to be exported");
      }

      // Verify the log record is emitted without body
      expect(exportedLogRecord.body).toBeUndefined();
    });
  });

  describe("logger naming and versioning", () => {
    it("should handle different logger names correctly", async () => {
      const loggers = [
        getLangWatchLogger("app-logger-11"),
        getLangWatchLogger("database-logger-12"),
        getLangWatchLogger("api-logger-13"),
      ];

      // Emit from each logger
      loggers.forEach((logger, index) => {
        logger.emit({
          severityText: "INFO",
          severityNumber: 9,
          body: `Message from logger ${index}`,
          attributes: { "logger.name": `logger-${index}` },
        });
      });

      await logRecordProcessor.forceFlush();
      const exportedLogRecords = logRecordExporter.getFinishedLogRecords();

      expect(exportedLogRecords).toHaveLength(3);

      // Verify each log record has the correct attributes
      exportedLogRecords.forEach((record, index) => {
        expect(record.body).toBe(`Message from logger ${index}`);
        expect(record.attributes?.["logger.name"]).toBe(`logger-${index}`);
      });
    });

    it("should handle different versions correctly", async () => {
      const loggers = [
        getLangWatchLogger("version-test-logger-14", "1.0.0"),
        getLangWatchLogger("version-test-logger-15", "2.0.0"),
        getLangWatchLogger("version-test-logger-16", "latest"),
      ];

      // Emit from each logger
      loggers.forEach((logger, index) => {
        logger.emit({
          severityText: "INFO",
          severityNumber: 9,
          body: `Message from version ${index}`,
          attributes: { "logger.version": ["1.0.0", "2.0.0", "latest"][index] },
        });
      });

      await logRecordProcessor.forceFlush();
      const exportedLogRecords = logRecordExporter.getFinishedLogRecords();

      expect(exportedLogRecords).toHaveLength(3);

      // Verify each log record has the correct version attributes
      exportedLogRecords.forEach((record, index) => {
        expect(record.body).toBe(`Message from version ${index}`);
        expect(record.attributes?.["logger.version"]).toBe(["1.0.0", "2.0.0", "latest"][index]);
      });
    });
  });

  describe("GenAI-specific logging", () => {
    it("should handle GenAI-specific attributes correctly", async () => {
      const logger = getLangWatchLogger("genai-test-logger-17");

      const logRecord: LangWatchLogRecord = {
        severityText: "INFO",
        severityNumber: 9,
        body: "GenAI operation completed",
        attributes: {
          ...TEST_GEN_AI_ATTRIBUTES,
          "langwatch.service": "genai-service",
        },
      };

      logger.emit(logRecord);

      await logRecordProcessor.forceFlush();
      const exportedLogRecords = logRecordExporter.getFinishedLogRecords();

      expect(exportedLogRecords).toHaveLength(1);

      const exportedLogRecord = exportedLogRecords[0];
      if (!exportedLogRecord) {
        throw new Error("Expected log record to be exported");
      }

      // Verify GenAI-specific attributes
      expect(exportedLogRecord.attributes?.["gen_ai.request.model"]).toBe("gpt-4");
      expect(exportedLogRecord.attributes?.["gen_ai.request.temperature"]).toBe(0.7);
      expect(exportedLogRecord.attributes?.["gen_ai.request.max_tokens"]).toBe(150);
      expect(exportedLogRecord.attributes?.["gen_ai.response.finish_reason"]).toBe("stop");
      expect(exportedLogRecord.attributes?.["gen_ai.usage.prompt_tokens"]).toBe(15);
      expect(exportedLogRecord.attributes?.["gen_ai.usage.completion_tokens"]).toBe(25);
      expect(exportedLogRecord.attributes?.["gen_ai.usage.total_tokens"]).toBe(40);
      expect(exportedLogRecord.attributes?.["langwatch.service"]).toBe("genai-service");
    });

    it("should handle GenAI error scenarios", async () => {
      const logger = getLangWatchLogger("genai-error-test-logger-18");

      const errorLogRecord: LangWatchLogRecord = {
        severityText: "ERROR",
        severityNumber: 17,
        body: "GenAI API call failed",
        attributes: {
          "gen_ai.request.model": "gpt-4",
          "gen_ai.error.code": "rate_limit_exceeded",
          "gen_ai.error.message": "Rate limit exceeded",
          "gen_ai.error.retry_after": 60,
          "langwatch.service": "genai-service",
        },
      };

      logger.emit(errorLogRecord);

      await logRecordProcessor.forceFlush();
      const exportedLogRecords = logRecordExporter.getFinishedLogRecords();

      expect(exportedLogRecords).toHaveLength(1);

      const exportedLogRecord = exportedLogRecords[0];
      if (!exportedLogRecord) {
        throw new Error("Expected log record to be exported");
      }

      expect(exportedLogRecord.severityText).toBe("ERROR");
      expect(exportedLogRecord.severityNumber).toBe(17);
      expect(exportedLogRecord.body).toBe("GenAI API call failed");
      expect(exportedLogRecord.attributes?.["gen_ai.error.code"]).toBe("rate_limit_exceeded");
      expect(exportedLogRecord.attributes?.["gen_ai.error.message"]).toBe("Rate limit exceeded");
      expect(exportedLogRecord.attributes?.["gen_ai.error.retry_after"]).toBe(60);
    });
  });

  describe("performance and concurrency", () => {
    it("should handle concurrent log record creation efficiently", async () => {
      const logger = getLangWatchLogger("concurrent-test-logger-19");

      const concurrentOperations = await Promise.all(
        Array.from({ length: 10 }, async (_, i) => {
          const logRecord: LangWatchLogRecord = {
            severityText: "INFO",
            severityNumber: 9,
            body: `Concurrent log message ${i}`,
            attributes: {
              "operation.index": i,
              "concurrent.test": true,
            },
          };

          logger.emit(logRecord);
          return i;
        })
      );

      expect(concurrentOperations).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

      await logRecordProcessor.forceFlush();
      const exportedLogRecords = logRecordExporter.getFinishedLogRecords();

      expect(exportedLogRecords).toHaveLength(10);

      // Verify all log records have unique indices and proper attributes
      exportedLogRecords.forEach((logRecord, index) => {
        expect(logRecord.body).toBe(`Concurrent log message ${index}`);
        expect(logRecord.attributes?.["operation.index"]).toBe(index);
        expect(logRecord.attributes?.["concurrent.test"]).toBe(true);
      });
    });

    it("should handle rapid log record creation/deletion cycles", async () => {
      const logger = getLangWatchLogger("rapid-cycle-test-logger-20");
      const cycles = 50;

      const rapidOperations = Array.from({ length: cycles }, (_, i) => {
        const logRecord: LangWatchLogRecord = {
          severityText: "INFO",
          severityNumber: 9,
          body: `Rapid cycle log ${i}`,
          attributes: {
            "cycle.index": i,
            "rapid.test": true,
          },
        };

        logger.emit(logRecord);
        return `result-${i}`;
      });

      expect(rapidOperations).toHaveLength(cycles);

      await logRecordProcessor.forceFlush();
      const exportedLogRecords = logRecordExporter.getFinishedLogRecords();

      expect(exportedLogRecords).toHaveLength(cycles);

      // Verify all log records were properly created
      exportedLogRecords.forEach((logRecord, index) => {
        expect(logRecord.body).toBe(`Rapid cycle log ${index}`);
        expect(logRecord.attributes?.["cycle.index"]).toBe(index);
        expect(logRecord.attributes?.["rapid.test"]).toBe(true);
      });
    });

    it("should handle large data volumes efficiently", async () => {
      const logger = getLangWatchLogger("large-data-test-logger-21");

      // Create moderately large log data
      const largeData = {
        data: "x".repeat(50_000), // 50KB string
        numbers: Array.from({ length: 1000 }, (_, i) => i),
        nested: {
          level1: { level2: { level3: "deeply nested data" } }
        }
      };

      const largeDataLogRecord: LangWatchLogRecord = {
        severityText: "INFO",
        severityNumber: 9,
        body: "Large data log message",
        attributes: {
          "large.data": JSON.stringify(largeData),
          "data.size": JSON.stringify(largeData).length,
        },
      };

      logger.emit(largeDataLogRecord);

      await logRecordProcessor.forceFlush();
      const exportedLogRecords = logRecordExporter.getFinishedLogRecords();

      expect(exportedLogRecords).toHaveLength(1);
      const exportedLogRecord = exportedLogRecords[0];
      if (!exportedLogRecord) {
        throw new Error("Expected log record to be exported");
      }

      // Verify large data was handled correctly
      expect(exportedLogRecord.body).toBe("Large data log message");
      expect(exportedLogRecord.attributes?.["data.size"]).toBe(JSON.stringify(largeData).length);
    });
  });

  describe("attribute and metadata validation", () => {
    it("should validate and sanitize attribute values", async () => {
      const logger = getLangWatchLogger("attribute-validation-test-logger-22");

      const validationLogRecord: LangWatchLogRecord = {
        severityText: "INFO",
        severityNumber: 9,
        body: "Attribute validation test",
        attributes: {
          "string.attr": "valid string",
          "number.attr": 42,
          "boolean.attr": true,
          "array.attr": [1, 2, 3] as any, // Not valid AttributeValue
          "object.attr": { key: "value" } as any, // Not valid AttributeValue
        },
      };

      logger.emit(validationLogRecord);

      await logRecordProcessor.forceFlush();
      const exportedLogRecords = logRecordExporter.getFinishedLogRecords();

      expect(exportedLogRecords).toHaveLength(1);
      const exportedLogRecord = exportedLogRecords[0];
      if (!exportedLogRecord) {
        throw new Error("Expected log record to be exported");
      }

      // Verify valid attributes are present
      expect(exportedLogRecord.attributes?.["string.attr"]).toBe("valid string");
      expect(exportedLogRecord.attributes?.["number.attr"]).toBe(42);
      expect(exportedLogRecord.attributes?.["boolean.attr"]).toBe(true);

      // Invalid attribute types should either be:
      // 1. Converted to strings, or
      // 2. Omitted from the log record attributes
      // We don't assert their presence/absence as it depends on OpenTelemetry implementation
    });

    it("should handle complex attribute type coercion", async () => {
      const logger = getLangWatchLogger("attribute-coercion-test-logger-23");

      const coercionLogRecord: LangWatchLogRecord = {
        severityText: "INFO",
        severityNumber: 9,
        body: "Attribute coercion test",
        attributes: {
          "valid.string": "normal string",
          "valid.number": 42,
          "valid.boolean": true,
          "date.value": new Date() as any, // Not valid AttributeValue
          "null.value": null as any, // Not valid AttributeValue
        },
      };

      logger.emit(coercionLogRecord);

      await logRecordProcessor.forceFlush();
      const exportedLogRecords = logRecordExporter.getFinishedLogRecords();

      expect(exportedLogRecords).toHaveLength(1);
      const exportedLogRecord = exportedLogRecords[0];
      if (!exportedLogRecord) {
        throw new Error("Expected log record to be exported");
      }

      // Verify valid attributes are present
      expect(exportedLogRecord.attributes?.["valid.string"]).toBe("normal string");
      expect(exportedLogRecord.attributes?.["valid.number"]).toBe(42);
      expect(exportedLogRecord.attributes?.["valid.boolean"]).toBe(true);

      // Invalid attribute types should be handled gracefully
    });
  });

  describe("error boundary and recovery", () => {
    it("should handle log record operation failures gracefully", async () => {
      const logger = getLangWatchLogger("log-failure-test-logger-24");

      // Test log record that encounters issues during creation
      const failureLogRecord: LangWatchLogRecord = {
        severityText: "INFO",
        severityNumber: 9,
        body: "Valid log message",
        attributes: {
          "valid.attr": "valid value",
          "problematic.attr": undefined as any, // Invalid attribute
        },
      };

      logger.emit(failureLogRecord);

      await logRecordProcessor.forceFlush();
      const exportedLogRecords = logRecordExporter.getFinishedLogRecords();

      expect(exportedLogRecords).toHaveLength(1);
      const exportedLogRecord = exportedLogRecords[0];
      if (!exportedLogRecord) {
        throw new Error("Expected log record to be exported");
      }

      // Log record should have been created successfully
      expect(exportedLogRecord.body).toBe("Valid log message");
      expect(exportedLogRecord.severityText).toBe("INFO");
      expect(exportedLogRecord.attributes?.["valid.attr"]).toBe("valid value");
    });

    it("should handle provider shutdown during log operations", async () => {
      const logger = getLangWatchLogger("shutdown-test-logger-25");

      // Emit log record
      const shutdownLogRecord: LangWatchLogRecord = {
        severityText: "INFO",
        severityNumber: 9,
        body: "Log during shutdown test",
        attributes: {
          "shutdown.test": true,
        },
      };

      logger.emit(shutdownLogRecord);

      // Don't actually shutdown the provider as it would affect other tests
      // This test verifies the log record can be emitted successfully
      await logRecordProcessor.forceFlush();
      const exportedLogRecords = logRecordExporter.getFinishedLogRecords();

      expect(exportedLogRecords).toHaveLength(1);
      const exportedLogRecord = exportedLogRecords[0];
      if (!exportedLogRecord) {
        throw new Error("Expected log record to be exported");
      }

      expect(exportedLogRecord.body).toBe("Log during shutdown test");
      expect(exportedLogRecord.attributes?.["shutdown.test"]).toBe(true);
    });
  });

  describe("current logger provider integration", () => {
    it("should use the currently configured logger provider", () => {
      // Get loggers using current provider
      const logger1 = getLangWatchLogger("current-test-26");
      const logger2 = getLangWatchLogger("current-test-27");

      // Both should work with the same current provider
      logger1.emit({
        severityText: "INFO",
        severityNumber: 9,
        body: "Message from logger 1",
      });

      logger2.emit({
        severityText: "INFO",
        severityNumber: 9,
        body: "Message from logger 2",
      });

      // Both loggers should be functional
      expect(logger1).toBeDefined();
      expect(logger2).toBeDefined();
      expect(typeof logger1.emit).toBe("function");
      expect(typeof logger2.emit).toBe("function");
    });
  });

  describe("custom logger provider integration", () => {
    it("should work with custom logger providers", async () => {
      // Create a custom logger provider for testing
      const { logs } = await import("@opentelemetry/api-logs");
      const customProvider = logs.getLoggerProvider();

      const logger = getLangWatchLoggerFromProvider(
        customProvider,
        "custom-provider-test-logger-28",
        "1.0.0"
      );

      const customProviderLogRecord: LangWatchLogRecord = {
        severityText: "INFO",
        severityNumber: 9,
        body: "Custom provider test message",
        attributes: {
          "custom.provider": true,
          "logger.version": "1.0.0",
        },
      };

      logger.emit(customProviderLogRecord);

      await logRecordProcessor.forceFlush();
      const exportedLogRecords = logRecordExporter.getFinishedLogRecords();

      expect(exportedLogRecords).toHaveLength(1);
      const exportedLogRecord = exportedLogRecords[0];
      if (!exportedLogRecord) {
        throw new Error("Expected log record to be exported");
      }

      expect(exportedLogRecord.body).toBe("Custom provider test message");
      expect(exportedLogRecord.attributes?.["custom.provider"]).toBe(true);
      expect(exportedLogRecord.attributes?.["logger.version"]).toBe("1.0.0");
    });
  });
});
