/**
 * Shared utilities for end-to-end tests
 */

import { beforeAll, afterAll, afterEach, expect } from "vitest";
import { setupObservability } from "../../setup/node";
import { getLangWatchTracer } from "../../tracer";
import { LangWatch } from "../../../client-sdk";
import { LangWatchExporter } from "../../exporters";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { type Span as OtelSpan, trace } from "@opentelemetry/api";
import { type GetTraceResponse } from "../../../client-sdk/services/traces/types";

type Trace = GetTraceResponse;
type Span = NonNullable<Trace["spans"]>[number];

// =============================================================================
// Configuration and Environment
// =============================================================================

/**
 * Configuration for e2e tests from environment variables
 */
export const E2E_CONFIG = {
  apiKey: process.env.LANGWATCH_API_KEY,
  endpoint: process.env.LANGWATCH_ENDPOINT,
  timeout: parseInt(process.env.E2E_TIMEOUT ?? "30000", 10),
  retryDelay: parseInt(process.env.E2E_RETRY_DELAY ?? "1000", 10),
  maxRetries: parseInt(process.env.E2E_MAX_RETRIES ?? "3", 10),
  pollTimeout: parseInt(process.env.E2E_POLL_TIMEOUT ?? "22000", 10),
  pollInterval: parseInt(process.env.E2E_POLL_INTERVAL ?? "2000", 10),
} as const;

/**
 * Validates that required environment variables are set
 */
export function validateE2EEnvironment(): void {
  if (!E2E_CONFIG.apiKey) {
    throw new Error(
      "LANGWATCH_API_KEY environment variable is required for e2e tests. " +
      "Please set it to your LangWatch API key (e.g., LANGWATCH_API_KEY=sk-lw-...)"
    );
  }

  console.debug(`✅ E2E tests configured for endpoint: ${E2E_CONFIG.endpoint}`);
}

// =============================================================================
// Setup and Initialization
// =============================================================================

/**
 * Sets up LangWatch observability for e2e tests
 */
export function setupE2EObservability(): [LangWatchExporter, SimpleSpanProcessor] {
  console.debug("🔧 Setting up E2E observability...");

  const exporter = new LangWatchExporter({
    apiKey: E2E_CONFIG.apiKey!,
    endpoint: E2E_CONFIG.endpoint,
  });
  const spanProcessor = new SimpleSpanProcessor(exporter);

  console.debug("🔧 Calling setupObservability...");
  setupObservability({
    langwatch: 'disabled', // Disable built-in LangWatch exporter to avoid duplicate exports
    spanProcessors: [spanProcessor],
    langwatch: 'disabled',
    debug: { logLevel: "debug" },
    advanced: { UNSAFE_forceOpenTelemetryReinitialization: true },
  });

  console.debug("✅ E2E observability setup complete");
  return [exporter, spanProcessor];
}

/**
 * Sets up the LangWatch client SDK for e2e tests
 */
export function setupE2ELangWatchClientSDK(): LangWatch {
  return new LangWatch({
    apiKey: E2E_CONFIG.apiKey!,
    endpoint: E2E_CONFIG.endpoint,
  });
}

/**
 * Verifies that OpenTelemetry is properly initialized by creating a test span
 */
export async function verifyOpenTelemetrySetup(): Promise<void> {
  console.debug("🔍 Verifying OpenTelemetry setup...");

  const provider = trace.getTracerProvider();
  console.debug(`🔍 TracerProvider: ${provider.constructor.name}`);

  const testTracer = getLangWatchTracer("setup-verification");

  return new Promise((resolve, reject) => {
    const span = testTracer.startSpan("setup-verification-span");

    try {
      const context = span.spanContext();
      const traceId = context.traceId;

      console.debug(`🔍 Test span created with trace ID: ${traceId}`);

      if (traceId === "00000000000000000000000000000000") {
        reject(new Error("OpenTelemetry setup verification failed: trace ID is all zeros"));
        return;
      }

      if (!/^[0-9a-f]{32}$/i.test(traceId)) {
        reject(new Error(`OpenTelemetry setup verification failed: invalid trace ID format: ${traceId}`));
        return;
      }

      console.debug("✅ OpenTelemetry setup verification successful");
      resolve();
    } catch (error) {
      reject(new Error(`OpenTelemetry setup verification failed: ${String(error)}`));
    } finally {
      span.end();
    }
  });
}

/**
 * Standard e2e test setup that validates environment, sets up observability, and creates client
 */
export function setupE2ETest(): { client: LangWatch; spanProcessor: SimpleSpanProcessor } {
  let client: LangWatch;
  let spanProcessor: SimpleSpanProcessor;

  beforeAll(async () => {
    validateE2EEnvironment();
    [, spanProcessor] = setupE2EObservability();

    // Give the NodeSDK a moment to fully initialize
    await delay(500);

    // Verify that OpenTelemetry is properly set up
    await verifyOpenTelemetrySetup();

    client = setupE2ELangWatchClientSDK();
  });

  afterEach(async () => {
    await spanProcessor.forceFlush();
  });

  afterAll(async () => {
    // Final cleanup delay
    await delay(1000);
  });

  return {
    get client() {
      return client;
    },
    get spanProcessor() {
      return spanProcessor;
    }
  };
}

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Generates unique test identifiers to avoid conflicts
 */
export function generateTestIds(): {
  threadId: string;
  userId: string;
  sessionId: string;
  timestamp: string;
} {
  const timestamp = new Date().toISOString();
  const uniqueId = crypto.randomUUID().slice(0, 8);

  return {
    threadId: `e2e-thread-${uniqueId}`,
    userId: `e2e-user-${uniqueId}`,
    sessionId: `e2e-session-${uniqueId}`,
    timestamp,
  };
}

/**
 * Creates a test tracer with a unique name
 */
export function createTestTracer(testName: string) {
  const timestamp = Date.now();
  const tracerName = `e2e-test-${testName}-${timestamp}`;

  console.debug(`🔍 Creating test tracer: ${tracerName}`);

  // Check the global trace provider
  const tracer = getLangWatchTracer(tracerName);

  return tracer;
}

/**
 * Waits for a specified amount of time (useful for allowing traces to be processed)
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// Span and Trace ID Utilities
// =============================================================================

/**
 * Extracts the raw hex trace ID from an active span (without conversion).
 * Use this for local OpenTelemetry operations and comparisons.
 */
export function getRawTraceIdFromSpan(span: OtelSpan): string {
  if (!span?.spanContext) {
    throw new Error("Invalid span: missing spanContext method");
  }

  const context = span.spanContext();
  if (!context?.traceId) {
    throw new Error("Invalid span context: missing traceId");
  }

  const hexTraceId = context.traceId;

  // Validate that the trace ID is not all zeros (indicates OTel initialization issues)
  if (hexTraceId === "00000000000000000000000000000000") {
    throw new Error(
      "Invalid trace ID (all zeros) - this indicates OpenTelemetry is not properly initialized. " +
      "Check that setupObservability() was called and the NodeSDK started successfully."
    );
  }

  return hexTraceId;
}

/**
 * Extracts the trace ID from an active span and converts it to LangWatch's expected format.
 * This trace ID can be used directly for API lookups.
 */
export function getTraceIdFromSpan(span: OtelSpan): string {
  return getRawTraceIdFromSpan(span);
}

// =============================================================================
// Trace Validation and Polling
// =============================================================================

/**
 * Polls for a trace to be available via the API
 * This ensures that spans have been properly ingested and are accessible
 */
export async function pollForTrace(
  client: LangWatch,
  traceId: string,
  timeout: number = E2E_CONFIG.pollTimeout,
  expectedSpanCount?: number
): Promise<GetTraceResponse> {
  const startTime = Date.now();
  const pollInterval = E2E_CONFIG.pollInterval;

  while (Date.now() - startTime < timeout) {
    try {
      const trace = await client.traces.get(traceId, { includeSpans: true });
      if (trace?.spans?.length && trace.spans.length > 0) {
        // If we have an expected span count, wait for it
        if (expectedSpanCount !== undefined) {
          if (trace.spans.length >= expectedSpanCount) {
            console.debug(`✅ Trace ${traceId} found with ${trace.spans.length} spans (expected ${expectedSpanCount})`);
            return trace;
          } else {
            console.debug(`⏳ Trace ${traceId} has ${trace.spans.length} spans, waiting for ${expectedSpanCount}... (${Date.now() - startTime}ms elapsed)`);
          }
        } else {
          // No expected count, any spans are fine
          console.debug(`✅ Trace ${traceId} found with ${trace.spans.length} spans`);
          return trace;
        }
      }
    } catch (error) {
      // Trace not found yet, continue polling
      const errorMessage = (error as Error).message;
      if (!errorMessage.includes("not found") && !errorMessage.includes("404")) {
        console.warn(`⚠️ Unexpected error polling for trace ${traceId}:`, error);
      }
    }

    if (expectedSpanCount === undefined) {
      console.debug(`⏳ Waiting for trace ${traceId}... (${Date.now() - startTime}ms elapsed)`);
    }
    await delay(pollInterval);
  }

  const expectedMsg = expectedSpanCount ? ` with ${expectedSpanCount} spans` : '';
  throw new Error(`Timeout waiting for trace ${traceId}${expectedMsg} after ${timeout}ms`);
}

/**
 * Validates that a trace was created and sent successfully by polling the API
 */
export async function expectTraceToBeIngested(
  client: LangWatch,
  traceId: string,
  expectedSpanCount?: number,
  timeout?: number
): Promise<GetTraceResponse> {
  const trace = await pollForTrace(client, traceId, timeout, expectedSpanCount);

  expect(trace).toBeTruthy();
  expect(trace.spans).toBeTruthy();
  expect(Array.isArray(trace.spans)).toBe(true);
  expect(trace.spans!.length).toBeGreaterThan(0);

  if (expectedSpanCount !== undefined) {
    try {
    expect(trace.spans!.length).toBe(expectedSpanCount);
    } catch (error) {
      console.error(`Expected ${expectedSpanCount} spans, but got ${trace.spans!.length}`);
      console.error('Spans', trace.spans);
      throw error;
    }
  }

  // Validate that spans have the basic required structure
  for (const span of trace.spans!) {
    expect(span.span_id).toBeTruthy();
    expect(span.trace_id).toBe(traceId);
    expect(span.timestamps?.started_at).toBeTruthy();
    expect(span.timestamps?.finished_at).toBeTruthy();
  }

  return { ...trace, spans: trace.spans! };
}

// =============================================================================
// Span Validators
// =============================================================================

/**
 * Gets a nested property value using dot notation
 */
function getNestedProperty(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

/**
 * Helper function to validate span attributes, checking both span params and trace metadata
 */
export function expectSpanAttribute(span: NonNullable<GetTraceResponse["spans"]>[number], attributePath: string, expectedValue: any): void {
  // For LangWatch-specific attributes, use the backend field names directly
  let actualAttributePath = attributePath;
  if (attributePath === "langwatch.customer.id") {
    actualAttributePath = "customer_id";
  } else if (attributePath === "langwatch.thread.id") {
    actualAttributePath = "thread_id";
  } else if (attributePath === "langwatch.user.id") {
    actualAttributePath = "user_id";
  }

  const params = (span.params ?? {}) as Record<string, any>;

  // First try direct access with the actual attribute name
  if (params?.[actualAttributePath] !== undefined) {
    expect(params[actualAttributePath]).toBe(expectedValue);
    return;
  }

  // Then try nested access
  const nestedValue = getNestedProperty(span.params, actualAttributePath);
  if (nestedValue !== undefined) {
    expect(nestedValue).toBe(expectedValue);
    return;
  }

  // If neither works, fail with a helpful message
  const availableKeys = Object.keys(span.params ?? {}).join(', ');
  throw new Error(`Attribute '${attributePath}' (looking for: '${actualAttributePath}') not found in span params. Available keys: ${availableKeys}`);
}

/**
 * Helper function to validate span attributes, checking both span params and trace metadata
 * This version can access the trace object to check metadata for LangWatch attributes
 */
export function expectSpanAttributeWithTrace(trace: Trace, span: Span, attributePath: string, expectedValue: any): void {
  const metadata = (trace.metadata ?? {}) as Record<string, string>;

  // For LangWatch-specific attributes that are moved to trace metadata
  if (attributePath === "langwatch.customer.id") {
    if (metadata?.customer_id !== undefined) {
      expect(metadata.customer_id).toBe(expectedValue);
      return;
    }
  } else if (attributePath === "langwatch.thread.id") {
    if (metadata?.thread_id !== undefined) {
      expect(metadata.thread_id).toBe(expectedValue);
      return;
    }
  } else if (attributePath === "langwatch.user.id") {
    if (metadata?.user_id !== undefined) {
      expect(metadata.user_id).toBe(expectedValue);
      return;
    }
  }

  // Fall back to checking span params for non-metadata attributes
  expectSpanAttribute(span, attributePath, expectedValue);
}
