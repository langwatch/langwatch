/**
 * Client for fetching traces via POST /api/trace/search
 *
 * Uses the TraceService facade which routes to CH/ES based on project feature flags.
 * ES project API key -> ES-backed traces
 * CH project API key -> CH-backed traces
 */

import type { Trace } from "./types.js";
import { sleep } from "./utils.js";

interface TraceSearchResponse {
  traces: Trace[];
  pagination: {
    totalHits: number;
    scrollId: string | null;
  };
}

/**
 * Fetch traces from a project within a time range
 */
export async function fetchTraces({
  baseUrl,
  apiKey,
  startDate,
  endDate,
  pageSize = 1000,
  scrollId,
}: {
  baseUrl: string;
  apiKey: string;
  startDate: number;
  endDate: number;
  pageSize?: number;
  scrollId?: string | null;
}): Promise<TraceSearchResponse> {
  const url = `${baseUrl}/api/trace/search`;

  const body: Record<string, unknown> = {
    startDate,
    endDate,
    pageSize,
  };

  if (scrollId) {
    body.scrollId = scrollId;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "X-Auth-Token": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Trace search failed: HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  return (await response.json()) as TraceSearchResponse;
}

/**
 * Fetch all traces (single request, expects < 1000 traces for parity check)
 */
export async function fetchAllTraces({
  baseUrl,
  apiKey,
  startDate,
  endDate,
}: {
  baseUrl: string;
  apiKey: string;
  startDate: number;
  endDate: number;
}): Promise<Trace[]> {
  const result = await fetchTraces({
    baseUrl,
    apiKey,
    startDate,
    endDate,
    pageSize: 1000,
  });

  return result.traces;
}

/**
 * Poll until expected trace count is reached in both backends
 */
export async function pollUntilTracesReady({
  baseUrl,
  esApiKey,
  chApiKey,
  expectedCount,
  startDate,
  endDate,
  maxWaitMs = 120000,
  pollIntervalMs = 3000,
}: {
  baseUrl: string;
  esApiKey: string;
  chApiKey: string;
  expectedCount: number;
  startDate: number;
  endDate: number;
  maxWaitMs?: number;
  pollIntervalMs?: number;
}): Promise<{
  esReady: boolean;
  chReady: boolean;
  esCount: number;
  chCount: number;
  esError: string | null;
  chError: string | null;
}> {
  const startTime = Date.now();
  let esCount = 0;
  let chCount = 0;
  let esError: string | null = null;
  let chError: string | null = null;

  console.log(`  Polling for ${expectedCount} traces (timeout: ${maxWaitMs / 1000}s)...`);

  while (Date.now() - startTime < maxWaitMs) {
    const [esResult, chResult] = await Promise.allSettled([
      fetchTraces({ baseUrl, apiKey: esApiKey, startDate, endDate, pageSize: 1 }),
      fetchTraces({ baseUrl, apiKey: chApiKey, startDate, endDate, pageSize: 1 }),
    ]);

    if (esResult.status === "fulfilled") {
      esCount = esResult.value.pagination.totalHits;
      esError = null;
    } else {
      esError = esResult.reason instanceof Error ? esResult.reason.message : String(esResult.reason);
    }

    if (chResult.status === "fulfilled") {
      chCount = chResult.value.pagination.totalHits;
      chError = null;
    } else {
      chError = chResult.reason instanceof Error ? chResult.reason.message : String(chResult.reason);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    process.stdout.write(
      `\r  [${elapsed}s] ES: ${esCount}/${expectedCount}, CH: ${chCount}/${expectedCount}${esError ? " (ES error)" : ""}${chError ? " (CH error)" : ""}   `,
    );

    const esReady = esCount >= expectedCount;
    const chReady = chCount >= expectedCount;

    if (esReady && chReady) {
      console.log(`\n  Both projects ready!`);
      return { esReady, chReady, esCount, chCount, esError, chError };
    }

    if (esError && chError) {
      console.log(`\n  Both projects have errors, stopping poll`);
      return { esReady: false, chReady: false, esCount, chCount, esError, chError };
    }

    await sleep(pollIntervalMs);
  }

  console.log(`\n  Timeout reached. ES: ${esCount}/${expectedCount}, CH: ${chCount}/${expectedCount}`);
  return {
    esReady: esCount >= expectedCount,
    chReady: chCount >= expectedCount,
    esCount,
    chCount,
    esError,
    chError,
  };
}

