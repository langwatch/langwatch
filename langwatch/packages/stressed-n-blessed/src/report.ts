import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

import type {
  StressTestConfig,
  StressTestReport,
  StressTestStats,
  TestMode,
  TraceRecord,
} from './types.js';

export function generateRunId(): string {
  return `run_${Date.now()}_${randomBytes(4).toString('hex')}`;
}

export function generateDefaultReportPath(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `./stress-test-report-${timestamp}.json`;
}

export interface CreateReportOptions {
  runId: string;
  mode: TestMode;
  config: StressTestConfig;
  stats: StressTestStats;
  traces: TraceRecord[];
}

export function createReport(options: CreateReportOptions): StressTestReport {
  const { runId, mode, config, stats, traces } = options;
  const duration = (stats.endTime - stats.startTime) / 1000;

  return {
    runId,
    timestamp: new Date().toISOString(),
    mode,
    config: {
      totalTraces: config.totalTraces,
      avgSpansPerTrace: config.avgSpansPerTrace,
      maxDepth: config.maxDepth,
    },
    stats: {
      duration,
      tracesSent: stats.tracesSent,
      spansSent: stats.spansSent,
      errors: stats.errors,
      throughput: duration > 0 ? stats.spansSent / duration : 0,
    },
    traces,
  };
}

export async function saveReport(report: StressTestReport, path: string): Promise<void> {
  const content = JSON.stringify(report, null, 2);
  await writeFile(path, content, 'utf-8');
  console.log(`Report saved to: ${path}`);
}

export async function loadReport(path: string): Promise<StressTestReport> {
  const content = await readFile(path, 'utf-8');
  return JSON.parse(content) as StressTestReport;
}

export function printReportSummary(report: StressTestReport): void {
  console.log('\nStress Test Report Summary:');
  console.log('===========================');
  console.log(`Run ID: ${report.runId}`);
  console.log(`Timestamp: ${report.timestamp}`);
  console.log(`Mode: ${report.mode}`);
  console.log('\nConfiguration:');
  console.log(`  - Total Traces: ${report.config.totalTraces}`);
  console.log(`  - Avg Spans/Trace: ${report.config.avgSpansPerTrace}`);
  console.log(`  - Max Depth: ${report.config.maxDepth}`);
  console.log('\nStatistics:');
  console.log(`  - Duration: ${report.stats.duration.toFixed(2)}s`);
  console.log(`  - Traces Sent: ${report.stats.tracesSent}`);
  console.log(`  - Spans Sent: ${report.stats.spansSent}`);
  console.log(`  - Errors: ${report.stats.errors}`);
  console.log(`  - Throughput: ${report.stats.throughput.toFixed(2)} spans/second`);
  console.log('\nTraces:');
  console.log(`  - Total Traces in Report: ${report.traces.length}`);

  const totalSpans = report.traces.reduce((sum, t) => sum + t.spans.length, 0);
  console.log(`  - Total Spans in Report: ${totalSpans}`);
}
