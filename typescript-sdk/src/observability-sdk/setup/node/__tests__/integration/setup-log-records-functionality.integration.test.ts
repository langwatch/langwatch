import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupObservability } from '../../setup';
import { InMemoryLogRecordExporter, SimpleLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { getLangWatchLogger } from '../../../../logger';
import { resetObservabilitySdkConfig } from '../../../../config.js';

// Integration tests for log records functionality in setupObservability
function createMockLogger() {
  return { error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
}



describe('setupObservability Integration - Log Records Functionality', () => {
  let logRecordExporter: InMemoryLogRecordExporter;
  let logRecordProcessor: SimpleLogRecordProcessor;
  let observabilityHandle: ReturnType<typeof setupObservability>;

  beforeEach(() => {
    // Reset OpenTelemetry global state
    vi.resetModules();
    resetObservabilitySdkConfig();

    // Create fresh processor and exporter for each test
    logRecordExporter = new InMemoryLogRecordExporter();
    logRecordProcessor = new SimpleLogRecordProcessor(logRecordExporter);

    // Setup observability with real OpenTelemetry SDK
    observabilityHandle = setupObservability({
      serviceName: "log-records-functionality-test",
      langwatch: 'disabled', // Disable LangWatch to use only custom processors
      logRecordProcessors: [logRecordProcessor],
      debug: { logger: createMockLogger() },
      advanced: { throwOnSetupError: true },
      attributes: {
        "test.suite": "log-records-functionality",
        "test.environment": "vitest"
      },
    });
  });

  afterEach(async () => {
    await logRecordProcessor.forceFlush();
    await observabilityHandle.shutdown();
    logRecordExporter.reset();
    resetObservabilitySdkConfig();
  });

  it('should create log records with correct attributes', async () => {
    const logRecordLogger = getLangWatchLogger('test-logger');

    // Create a log record with attributes
    logRecordLogger.emit({
      severityText: 'INFO',
      severityNumber: 9, // INFO level
      body: 'Test log message',
      attributes: {
        'log.source': 'test-integration',
        'log.category': 'test',
        'user.id': '12345',
      },
    });

    await logRecordProcessor.forceFlush();
    const exportedLogRecords = logRecordExporter.getFinishedLogRecords();
    expect(exportedLogRecords).toHaveLength(1);

    const record = exportedLogRecords[0];
    if (!record) {
      throw new Error('No record found');
    }
    if (!record.attributes) {
      throw new Error('No attributes found');
    }
    expect(record.severityText).toBe('INFO');
    expect(record.severityNumber).toBe(9);
    expect(record.body).toBe('Test log message');
    expect(record.attributes["log.source"]).toBe('test-integration');
    expect(record.attributes["log.category"]).toBe('test');
    expect(record.attributes["user.id"]).toBe('12345');
  });

  it('should handle log records with custom log record processors', async () => {
    const logRecordLogger = getLangWatchLogger('custom-processor-test');

    const logRecord = {
      severityText: 'INFO',
      severityNumber: 9,
      body: 'Custom processor test message',
      attributes: {
        'custom.processor': true,
        'test.feature': 'custom-processors',
      },
    };

    logRecordLogger.emit(logRecord);

    await logRecordProcessor.forceFlush();
    const exportedLogRecords = logRecordExporter.getFinishedLogRecords();
    expect(exportedLogRecords).toHaveLength(1);

    const record = exportedLogRecords[0];
    if (!record) {
      throw new Error('No record found');
    }
    expect(record.severityText).toBe('INFO');
    expect(record.severityNumber).toBe(9);
    expect(record.body).toBe('Custom processor test message');
    expect(record.attributes?.['custom.processor']).toBe(true);
    expect(record.attributes?.['test.feature']).toBe('custom-processors');
  });

  it('should handle different log severity levels', async () => {
    const logRecordLogger = getLangWatchLogger('severity-test');

    // Test different severity levels
    const severityLevels = [
      { text: 'TRACE', number: 1 },
      { text: 'DEBUG', number: 5 },
      { text: 'INFO', number: 9 },
      { text: 'WARN', number: 13 },
      { text: 'ERROR', number: 17 },
      { text: 'FATAL', number: 21 },
    ];

    for (const level of severityLevels) {
      logRecordLogger.emit({
        severityText: level.text,
        severityNumber: level.number,
        body: `Test ${level.text} message`,
        attributes: {
          'log.level': level.text,
          'test.severity': level.number,
        },
      });
    }

    await logRecordProcessor.forceFlush();
    const exportedLogRecords = logRecordExporter.getFinishedLogRecords();
    expect(exportedLogRecords).toHaveLength(severityLevels.length);

    for (let i = 0; i < severityLevels.length; i++) {
      const record = exportedLogRecords[i];
      if (!record) {
        throw new Error('No record found');
      }
      if (!record.attributes) {
        throw new Error('No attributes found');
      }
      expect(record).toBeDefined();
      expect(record.severityText).toBe(severityLevels[i]?.text);
      expect(record.severityNumber).toBe(severityLevels[i]?.number);
      expect(record.body).toBe(`Test ${severityLevels[i]?.text} message`);
      expect(record.attributes["log.level"]).toBe(severityLevels[i]?.text);
      expect(record.attributes["test.severity"]).toBe(severityLevels[i]?.number);
    }
  });

  it('should handle log records with complex attributes', async () => {
    const logRecordLogger = getLangWatchLogger('complex-attributes');

    // Create a log record with complex attributes
    logRecordLogger.emit({
      severityText: 'INFO',
      severityNumber: 9,
      body: 'Complex attribute test',
      attributes: {
        'string.attr': 'string value',
        'number.attr': 42,
        'boolean.attr': true,
        'array.attr': ['item1', 'item2', 'item3'],
        'object.attr': { key1: 'value1', key2: 'value2' },
        'null.attr': undefined,
        'undefined.attr': undefined,
      },
    });

    await logRecordProcessor.forceFlush();
    const exportedLogRecords = logRecordExporter.getFinishedLogRecords();
    expect(exportedLogRecords).toHaveLength(1);

    const record = exportedLogRecords[0];
    if (!record) {
      throw new Error('No record found');
    }
    expect(record.severityText).toBe('INFO');
    expect(record.severityNumber).toBe(9);
    expect(record.body).toBe('Complex attribute test');

    if (!record.attributes) {
      throw new Error('No attributes found');
    }
    expect(record.attributes["string.attr"]).toBe('string value');
    expect(record.attributes["number.attr"]).toBe(42);
    expect(record.attributes["boolean.attr"]).toBe(true);
    expect(record.attributes["array.attr"]).toEqual(['item1', 'item2', 'item3']);
    expect(record.attributes["object.attr"]).toEqual({ key1: 'value1', key2: 'value2' });
    expect(record.attributes["null.attr"]).toBeUndefined();
    expect(record.attributes["undefined.attr"]).toBeUndefined();
  });

  it('should handle log records with timestamps', () => {
    const logger = createMockLogger();
    setupObservability({ langwatch: { apiKey: 'test-key' }, debug: { logger } });

    const logRecordLogger = getLangWatchLogger('timestamp-test');

    const now = Date.now();
    const timestamp = new Date(now);

    logRecordLogger.emit({
      severityText: 'INFO',
      severityNumber: 9,
      body: 'Timestamp test message',
      timestamp: timestamp,
      attributes: {
        'log.timestamp': now,
        'log.timestamp.iso': timestamp.toISOString(),
      },
    });

    expect(logRecordLogger).toBeDefined();
  });

  it('should handle log records with trace context', () => {
    const logger = createMockLogger();
    setupObservability({ langwatch: { apiKey: 'test-key' }, debug: { logger } });

    const logRecordLogger = getLangWatchLogger('trace-context-test');

    // Create a log record that could be associated with a trace
    logRecordLogger.emit({
      severityText: 'INFO',
      severityNumber: 9,
      body: 'Trace context test message',
      attributes: {
        'trace.id': 'test-trace-id',
        'span.id': 'test-span-id',
        'operation.name': 'test-operation',
      },
    });

    expect(logRecordLogger).toBeDefined();
  });

  it('should handle multiple log records from same logger', () => {
    const logger = createMockLogger();
    setupObservability({ langwatch: { apiKey: 'test-key' }, debug: { logger } });

    const logRecordLogger = getLangWatchLogger('multiple-logs');

    // Emit multiple log records
    for (let i = 0; i < 5; i++) {
      logRecordLogger.emit({
        severityText: 'INFO',
        severityNumber: 9,
        body: `Log message ${i + 1}`,
        attributes: {
          'log.sequence': i,
          'log.batch': 'multiple-test',
        },
      });
    }

    expect(logRecordLogger).toBeDefined();
  });

  it('should handle log records with different loggers', () => {
    const logger = createMockLogger();
    setupObservability({ langwatch: { apiKey: 'test-key' }, debug: { logger } });

    // Create multiple loggers
    const logger1 = getLangWatchLogger('logger-1');
    const logger2 = getLangWatchLogger('logger-2');
    const logger3 = getLangWatchLogger('logger-3');

    // Emit logs from different loggers
    logger1.emit({
      severityText: 'INFO',
      severityNumber: 9,
      body: 'Message from logger 1',
      attributes: { 'logger.name': 'logger-1' },
    });

    logger2.emit({
      severityText: 'WARN',
      severityNumber: 13,
      body: 'Message from logger 2',
      attributes: { 'logger.name': 'logger-2' },
    });

    logger3.emit({
      severityText: 'ERROR',
      severityNumber: 17,
      body: 'Message from logger 3',
      attributes: { 'logger.name': 'logger-3' },
    });

    expect(logger1).toBeDefined();
    expect(logger2).toBeDefined();
    expect(logger3).toBeDefined();
  });

  it('should handle log records with console logging enabled', () => {
    const logger = createMockLogger();
    setupObservability({
      langwatch: { apiKey: 'test-key' },
      debug: { logger, consoleLogging: true },
    });

    const logRecordLogger = getLangWatchLogger('console-logging-test');

    logRecordLogger.emit({
      severityText: 'INFO',
      severityNumber: 9,
      body: 'Console logging test message',
      attributes: {
        'console.logging': true,
        'test.feature': 'console-logging',
      },
    });

    expect(logRecordLogger).toBeDefined();
  });

  it('should handle log records with error conditions', () => {
    const logger = createMockLogger();
    setupObservability({ langwatch: { apiKey: 'test-key' }, debug: { logger } });

    const logRecordLogger = getLangWatchLogger("error-test")

    // Test error log records
    logRecordLogger.emit({
      severityText: 'ERROR',
      severityNumber: 17,
      body: 'Error test message',
      attributes: {
        'error.type': 'TestError',
        'error.message': 'This is a test error',
        'error.stack': 'Error: Test error\n    at test.js:1:1',
      },
    });

    expect(logRecordLogger).toBeDefined();
  });

  it('should handle log records with performance metrics', () => {
    const logger = createMockLogger();
    setupObservability({ langwatch: { apiKey: 'test-key' }, debug: { logger } });

    const logRecordLogger = getLangWatchLogger('performance-test');

    const startTime = Date.now();

    logRecordLogger.emit({
      severityText: 'INFO',
      severityNumber: 9,
      body: 'Performance test message',
      attributes: {
        'performance.duration': 150,
        'performance.operation': 'test-operation',
        'performance.start_time': startTime,
        'performance.end_time': startTime + 150,
      },
    });

    expect(logRecordLogger).toBeDefined();
  });

  it('should handle log records with business context', () => {
    const logger = createMockLogger();
    setupObservability({ langwatch: { apiKey: 'test-key' }, debug: { logger } });

    const logRecordLogger = getLangWatchLogger('business-context-test');

    logRecordLogger.emit({
      severityText: 'INFO',
      severityNumber: 9,
      body: 'Business context test message',
      attributes: {
        'business.user_id': 'user-12345',
        'business.tenant_id': 'tenant-67890',
        'business.operation': 'user_login',
        'business.feature': 'authentication',
        'business.environment': 'production',
      },
    });

    expect(logRecordLogger).toBeDefined();
  });

  it('should handle log records with security context', () => {
    const logger = createMockLogger();
    setupObservability({ langwatch: { apiKey: 'test-key' }, debug: { logger } });

    const logRecordLogger = getLangWatchLogger('security-test');

    logRecordLogger.emit({
      severityText: 'WARN',
      severityNumber: 13,
      body: 'Security test message',
      attributes: {
        'security.event_type': 'authentication_failure',
        'security.user_ip': '192.168.1.100',
        'security.user_agent': 'Mozilla/5.0...',
        'security.risk_level': 'medium',
      },
    });

    expect(logRecordLogger).toBeDefined();
  });

  it('should handle log records with application metrics', () => {
    const logger = createMockLogger();
    setupObservability({ langwatch: { apiKey: 'test-key' }, debug: { logger } });

    const logRecordLogger = getLangWatchLogger('metrics-test');

    logRecordLogger.emit({
      severityText: 'INFO',
      severityNumber: 9,
      body: 'Application metrics test message',
      attributes: {
        'metrics.cpu_usage': 45.2,
        'metrics.memory_usage': 67.8,
        'metrics.response_time': 125,
        'metrics.request_count': 1000,
        'metrics.error_rate': 0.02,
      },
    });

    expect(logRecordLogger).toBeDefined();
  });

  it('should handle log records with structured data', () => {
    const logger = createMockLogger();
    setupObservability({ langwatch: { apiKey: 'test-key' }, debug: { logger } });

    const logRecordLogger = getLangWatchLogger('structured-data-test');

    const structuredData = {
      user: {
        id: 'user-123',
        name: 'John Doe',
        email: 'john@example.com',
        preferences: {
          theme: 'dark',
          language: 'en',
        },
      },
      order: {
        id: 'order-456',
        items: [
          { id: 'item-1', name: 'Product A', price: 29.99 },
          { id: 'item-2', name: 'Product B', price: 19.99 },
        ],
        total: 49.98,
      },
    };

    logRecordLogger.emit({
      severityText: 'INFO',
      severityNumber: 9,
      body: 'Structured data test message',
      attributes: {
        'structured_data': JSON.stringify(structuredData),
        'data_type': 'user_order',
        'data_version': '1.0',
      },
    });

    expect(logRecordLogger).toBeDefined();
  });

  it('should handle log records with multiple processors', () => {
    const logger = createMockLogger();
    const processor1 = {
      onEmit: vi.fn(),
      shutdown: vi.fn(),
      forceFlush: vi.fn(),
    };
    const processor2 = {
      onEmit: vi.fn(),
      shutdown: vi.fn(),
      forceFlush: vi.fn(),
    };

    setupObservability({
      langwatch: { apiKey: 'test-key' },
      debug: { logger },
      logRecordProcessors: [processor1, processor2]
    });

    const logRecordLogger = getLangWatchLogger('multiple-processors-test');

    logRecordLogger.emit({
      severityText: 'INFO',
      severityNumber: 9,
      body: 'Multiple processors test message',
      attributes: {
        'test.processors': 2,
        'test.feature': 'multiple-processors',
      },
    });

    expect(logRecordLogger).toBeDefined();
    expect(processor1).toBeDefined();
    expect(processor2).toBeDefined();
  });

  it('should handle log records with different log levels and console logging', () => {
    const logger = createMockLogger();
    setupObservability({
      langwatch: { apiKey: 'test-key' },
      debug: { logger, consoleTracing: true },
    });

    const logRecordLogger = getLangWatchLogger('console-levels-test');

    // Test different levels with console logging enabled
    const levels = [
      { text: 'DEBUG', number: 5 },
      { text: 'INFO', number: 9 },
      { text: 'WARN', number: 13 },
      { text: 'ERROR', number: 17 },
    ];

    for (const level of levels) {
      logRecordLogger.emit({
        severityText: level.text,
        severityNumber: level.number,
        body: `Console ${level.text} test message`,
        attributes: {
          'console.logging': true,
          'log.level': level.text,
        },
      });
    }

    expect(logRecordLogger).toBeDefined();
  });

  it('should handle log records with resource attributes', () => {
    const logger = createMockLogger();
    setupObservability({
      langwatch: { apiKey: 'test-key' },
      debug: { logger },
      attributes: {
        'service.name': 'test-service',
        'service.version': '1.0.0',
        'deployment.environment': 'test',
      }
    });

    const logRecordLogger = getLangWatchLogger('resource-attributes-test');

    logRecordLogger.emit({
      severityText: 'INFO',
      severityNumber: 9,
      body: 'Resource attributes test message',
      attributes: {
        'custom.attribute': 'test-value',
        'test.resource': true,
      },
    });

    expect(logRecordLogger).toBeDefined();
  });
});
