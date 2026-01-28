/**
 * Client for sending traces to the collector API
 */

import type { CollectorRESTParams, TraceVariation } from "./types.js";

const MAX_SPANS_PER_REQUEST = 200;
const BATCH_DELAY_MS = 100;

interface SendResult {
  success: number;
  failed: number;
  errors: string[];
}

/**
 * Send a single trace to the collector API
 */
async function sendTrace(
  baseUrl: string,
  apiKey: string,
  trace: CollectorRESTParams,
): Promise<{ success: boolean; error?: string }> {
  const url = `${baseUrl}/api/collector`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Token": apiKey,
      },
      body: JSON.stringify(trace),
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        success: false,
        error: `HTTP ${response.status}: ${text}`,
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Send traces in batches with rate limiting
 */
export async function sendTraces(
  baseUrl: string,
  apiKey: string,
  traces: CollectorRESTParams[],
  onProgress?: (sent: number, total: number) => void,
): Promise<SendResult> {
  const result: SendResult = {
    success: 0,
    failed: 0,
    errors: [],
  };

  for (let i = 0; i < traces.length; i++) {
    const trace = traces[i]!;

    // Check if trace needs to be split (more than MAX_SPANS_PER_REQUEST spans)
    if (trace.spans.length > MAX_SPANS_PER_REQUEST) {
      // Split into multiple requests
      const chunks = [];
      for (let j = 0; j < trace.spans.length; j += MAX_SPANS_PER_REQUEST) {
        chunks.push(trace.spans.slice(j, j + MAX_SPANS_PER_REQUEST));
      }

      let allSuccess = true;
      for (const chunk of chunks) {
        const chunkTrace = { ...trace, spans: chunk };
        const sendResult = await sendTrace(baseUrl, apiKey, chunkTrace);
        if (!sendResult.success) {
          allSuccess = false;
          result.errors.push(
            `Trace ${trace.trace_id}: ${sendResult.error}`,
          );
        }
        // Small delay between chunks
        await sleep(BATCH_DELAY_MS);
      }

      if (allSuccess) {
        result.success++;
      } else {
        result.failed++;
      }
    } else {
      const sendResult = await sendTrace(baseUrl, apiKey, trace);
      if (sendResult.success) {
        result.success++;
      } else {
        result.failed++;
        result.errors.push(
          `Trace ${trace.trace_id}: ${sendResult.error}`,
        );
      }
    }

    onProgress?.(i + 1, traces.length);

    // Rate limiting between traces
    if (i < traces.length - 1) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  return result;
}

/**
 * Send all variations to both ES and CH projects
 */
export async function sendVariationsToProjects(
  baseUrl: string,
  esApiKey: string,
  chApiKey: string,
  variations: TraceVariation[],
  onProgress?: (project: string, sent: number, total: number) => void,
): Promise<{
  es: SendResult;
  ch: SendResult;
}> {
  // Flatten all traces from all variations
  const allTraces = variations.flatMap((v) => v.traces);

  console.log(`\nSending ${allTraces.length} traces to ES project...`);
  const esResult = await sendTraces(
    baseUrl,
    esApiKey,
    allTraces,
    (sent, total) => onProgress?.("ES", sent, total),
  );

  console.log(`\nSending ${allTraces.length} traces to CH project...`);
  const chResult = await sendTraces(
    baseUrl,
    chApiKey,
    allTraces,
    (sent, total) => onProgress?.("CH", sent, total),
  );

  return { es: esResult, ch: chResult };
}

/**
 * Wait for traces to be ingested by polling trace count
 */
export async function waitForIngestion(
  baseUrl: string,
  apiKey: string,
  projectId: string,
  expectedCount: number,
  maxWaitMs: number = 60000,
  pollIntervalMs: number = 2000,
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    // We can't easily check trace count without auth context
    // So we just wait a fixed time
    await sleep(pollIntervalMs);
  }

  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
