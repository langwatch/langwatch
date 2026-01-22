import { LangWatch } from 'langwatch';

import { loadReport, printReportSummary } from './report.js';
import type { StressTestReport, TraceRecord, VerificationResult } from './types.js';

interface TraceSpan {
  span_id: string;
  name?: string;
}

interface TraceResponse {
  trace_id: string;
  spans?: TraceSpan[];
}

async function fetchTrace(
  client: LangWatch,
  traceId: string
): Promise<TraceResponse | null> {
  try {
    const response = await client.traces.get(traceId, { includeSpans: true });
    return response as TraceResponse;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('404') || errorMessage.includes('not found')) {
      return null;
    }
    console.error(`Error fetching trace ${traceId}:`, error);
    return null;
  }
}

function verifyTrace(
  expected: TraceRecord,
  actual: TraceResponse | null
): { traceMissing: boolean; missingSpanIds: string[] } {
  if (!actual) {
    return { traceMissing: true, missingSpanIds: [] };
  }

  const actualSpanIds = new Set(actual.spans?.map((s) => s.span_id) ?? []);
  const missingSpanIds = expected.spans
    .filter((s) => !actualSpanIds.has(s.spanId))
    .map((s) => s.spanId);

  return { traceMissing: false, missingSpanIds };
}

export async function runVerification(reportPath: string): Promise<VerificationResult> {
  const apiKey = process.env.LANGWATCH_API_KEY;
  const endpoint = process.env.LANGWATCH_ENDPOINT;

  if (!apiKey) {
    throw new Error('LANGWATCH_API_KEY environment variable is required');
  }

  const client = new LangWatch({ apiKey });

  console.log(`Loading report from: ${reportPath}`);
  const report: StressTestReport = await loadReport(reportPath);

  printReportSummary(report);

  console.log('\nStarting verification...');
  console.log(`Endpoint: ${endpoint ?? 'https://app.langwatch.ai'}`);
  console.log(`Verifying ${report.traces.length} traces...\n`);

  const result: VerificationResult = {
    tracesChecked: 0,
    tracesFound: 0,
    tracesMissing: 0,
    spansChecked: 0,
    spansFound: 0,
    spansMissing: 0,
    missingTraces: [],
    missingSpans: [],
  };

  const concurrency = 10;
  const traces = [...report.traces];

  while (traces.length > 0) {
    const batch = traces.splice(0, concurrency);
    const results = await Promise.all(
      batch.map(async (trace) => {
        const actual = await fetchTrace(client, trace.traceId);
        return { expected: trace, actual };
      })
    );

    for (const { expected, actual } of results) {
      result.tracesChecked++;
      result.spansChecked += expected.spans.length;

      const verification = verifyTrace(expected, actual);

      if (verification.traceMissing) {
        result.tracesMissing++;
        result.missingTraces.push(expected.traceId);
      } else {
        result.tracesFound++;
        const spansFoundInTrace = expected.spans.length - verification.missingSpanIds.length;
        result.spansFound += spansFoundInTrace;
        result.spansMissing += verification.missingSpanIds.length;

        for (const spanId of verification.missingSpanIds) {
          result.missingSpans.push({ traceId: expected.traceId, spanId });
        }
      }

      if (result.tracesChecked % 10 === 0 || result.tracesChecked === report.traces.length) {
        process.stdout.write(
          `\rProgress: ${result.tracesChecked}/${report.traces.length} traces checked`
        );
      }
    }
  }

  console.log('\n');

  return result;
}

export function printVerificationResult(result: VerificationResult): void {
  console.log('Verification Results:');
  console.log('=====================');
  console.log(`Traces checked: ${result.tracesChecked}`);
  console.log(`Traces found: ${result.tracesFound}`);
  console.log(`Traces missing: ${result.tracesMissing}`);
  console.log(`Spans checked: ${result.spansChecked}`);
  console.log(`Spans found: ${result.spansFound}`);
  console.log(`Spans missing: ${result.spansMissing}`);

  const traceSuccessRate =
    result.tracesChecked > 0 ? (result.tracesFound / result.tracesChecked) * 100 : 0;
  const spanSuccessRate =
    result.spansChecked > 0 ? (result.spansFound / result.spansChecked) * 100 : 0;

  console.log(`\nSuccess rates:`);
  console.log(`  - Traces: ${traceSuccessRate.toFixed(2)}%`);
  console.log(`  - Spans: ${spanSuccessRate.toFixed(2)}%`);

  if (result.missingTraces.length > 0) {
    console.log(`\nMissing traces (${result.missingTraces.length}):`);
    const displayLimit = 20;
    for (const traceId of result.missingTraces.slice(0, displayLimit)) {
      console.log(`  - ${traceId}`);
    }
    if (result.missingTraces.length > displayLimit) {
      console.log(`  ... and ${result.missingTraces.length - displayLimit} more`);
    }
  }

  if (result.missingSpans.length > 0) {
    console.log(`\nMissing spans (${result.missingSpans.length}):`);
    const displayLimit = 20;
    for (const { traceId, spanId } of result.missingSpans.slice(0, displayLimit)) {
      console.log(`  - ${traceId}/${spanId}`);
    }
    if (result.missingSpans.length > displayLimit) {
      console.log(`  ... and ${result.missingSpans.length - displayLimit} more`);
    }
  }

  if (result.tracesMissing === 0 && result.spansMissing === 0) {
    console.log('\nAll traces and spans verified successfully!');
  }
}
