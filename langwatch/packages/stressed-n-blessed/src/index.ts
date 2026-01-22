import 'dotenv/config';

import { performance } from 'node:perf_hooks';

import { SpanKind, context, trace } from '@opentelemetry/api';
import { program } from 'commander';
import { getLangWatchTracer } from 'langwatch/observability';
import { setupObservability } from 'langwatch/observability/node';

import { getRandomSpanGenerator } from './generators.js';
import {
  createReport,
  generateDefaultReportPath,
  generateRunId,
  printReportSummary,
  saveReport,
} from './report.js';
import type {
  SpanRecord,
  StressTestConfig,
  StressTestStats,
  TestMode,
  TraceRecord,
} from './types.js';
import { MODE_CONFIGS } from './types.js';
import { printVerificationResult, runVerification } from './verify.js';

setupObservability({
  attributes: {
    'service.name': 'langwatch-backend',
    'deployment.environment': process.env.ENVIRONMENT,
  },
});

const tracer = getLangWatchTracer('stress-test-tracer');

const traceRecords: TraceRecord[] = [];

function createSpansForTrace(
  traceIndex: number,
  spansToCreate: number,
  config: StressTestConfig
): { spansCreated: number; traceRecord: TraceRecord } {
  const spanRecords: SpanRecord[] = [];

  const rootSpan = tracer.startSpan(`trace-${traceIndex}-root`, {
    kind: SpanKind.SERVER,
    attributes: {
      'stress-test.trace-index': traceIndex,
      'stress-test.mode': config.mode,
      'langwatch.customer.id': `customer_stress_${traceIndex % 10}`,
      'langwatch.user.id': `user_stress_${traceIndex % 100}`,
      'langwatch.thread.id': `thread_stress_${traceIndex}`,
      'langwatch.tags': JSON.stringify(['stress-test', config.mode]),
    },
  });

  const rootSpanContext = trace.setSpan(context.active(), rootSpan);
  const rootTraceId = rootSpan.spanContext().traceId;
  const rootSpanId = rootSpan.spanContext().spanId;

  const { type: rootType, generator: rootGenerator } = getRandomSpanGenerator();
  rootGenerator(rootSpan, `trace-${traceIndex}-root`);

  spanRecords.push({
    spanId: rootSpanId,
    name: `trace-${traceIndex}-root`,
    type: rootType,
  });

  context.with(rootSpanContext, () => {
    for (let i = 1; i < spansToCreate; i++) {
      const spanName = `trace-${traceIndex}-span-${i}`;
      const { type, generator } = getRandomSpanGenerator();

      const span = tracer.startSpan(spanName, {
        kind: SpanKind.INTERNAL,
        attributes: {
          'stress-test.trace-index': traceIndex,
          'stress-test.span-index': i,
          'stress-test.mode': config.mode,
        },
      });

      generator(span, spanName);

      spanRecords.push({
        spanId: span.spanContext().spanId,
        name: spanName,
        type,
      });

      span.end();
    }
  });

  rootSpan.end();

  return {
    spansCreated: spansToCreate,
    traceRecord: {
      traceId: rootTraceId,
      spans: spanRecords,
    },
  };
}

async function createTrace(traceIndex: number, config: StressTestConfig): Promise<number> {
  const spansForThisTrace = Math.max(
    1,
    Math.floor(config.avgSpansPerTrace * (0.5 + Math.random()))
  );

  console.log(`Creating trace ${traceIndex} with ${spansForThisTrace} spans`);

  const { spansCreated, traceRecord } = createSpansForTrace(
    traceIndex,
    spansForThisTrace,
    config
  );

  traceRecords.push(traceRecord);

  console.log(`Trace ${traceIndex} completed: created ${spansCreated} spans (traceId: ${traceRecord.traceId})`);

  return spansCreated;
}

async function runStressTest(config: StressTestConfig): Promise<void> {
  const stats: StressTestStats = {
    requestsSent: 0,
    tracesSent: 0,
    spansSent: 0,
    errors: 0,
    startTime: performance.now(),
    endTime: 0,
  };

  const runId = generateRunId();
  const modeConfig = MODE_CONFIGS[config.mode];

  console.log(`\nStress Test: ${config.mode.toUpperCase()} mode`);
  console.log(`Description: ${modeConfig.description}`);
  console.log(`Run ID: ${runId}`);
  console.log(`Configuration:`, {
    totalTraces: config.totalTraces,
    avgSpansPerTrace: config.avgSpansPerTrace,
    maxDepth: config.maxDepth,
    delayRange: `${modeConfig.minDelay}-${modeConfig.maxDelay}ms`,
  });
  console.log('\n');

  const promises: Promise<void>[] = [];

  for (let i = 0; i < config.totalTraces; i++) {
    const delay =
      modeConfig.minDelay +
      Math.floor(Math.random() * (modeConfig.maxDelay - modeConfig.minDelay));

    promises.push(
      new Promise((resolve) => {
        setTimeout(async () => {
          try {
            const spansCreated = await createTrace(i, config);
            stats.tracesSent++;
            stats.spansSent += spansCreated;
          } catch (error) {
            console.error(`Error creating trace ${i}:`, error);
            stats.errors++;
          }
          resolve();
        }, delay);
      })
    );
  }

  await Promise.all(promises);

  console.log('\nWaiting for spans to be sent...');
  await new Promise((resolve) => setTimeout(resolve, 5000));

  stats.endTime = performance.now();

  const report = createReport({
    runId,
    mode: config.mode,
    config,
    stats,
    traces: traceRecords,
  });

  printReportSummary(report);

  const reportPath = config.reportPath ?? generateDefaultReportPath();
  await saveReport(report, reportPath);

  console.log('\nStress test completed successfully.');
  console.log(`\nTo verify the traces, run:`);
  console.log(`  npx stressed-n-blessed verify --report ${reportPath}`);
}

program
  .name('stressed-n-blessed')
  .description('Stress test OTLP traces endpoint with realistic span data')
  .version('1.0.0');

program
  .command('run', { isDefault: true })
  .description('Run the stress test')
  .option('-m, --mode <mode>', 'Test mode: realistic, heavy, or scale', 'realistic')
  .option('-t, --traces <number>', 'Number of traces to generate (overrides mode default)')
  .option('-d, --depth <number>', 'Maximum depth of nested spans', '5')
  .option(
    '-s, --spans-per-trace <number>',
    'Average spans per trace (overrides mode default)'
  )
  .option('--report <path>', 'Custom report file path')
  .action(async (options) => {
    const mode = options.mode as TestMode;

    if (!MODE_CONFIGS[mode]) {
      console.error(`Invalid mode: ${mode}. Valid modes: realistic, heavy, scale`);
      process.exit(1);
    }

    const modeConfig = MODE_CONFIGS[mode];

    const config: StressTestConfig = {
      mode,
      totalTraces: options.traces
        ? parseInt(options.traces, 10)
        : modeConfig.defaultTraces,
      maxDepth: parseInt(options.depth, 10),
      avgSpansPerTrace: options.spansPerTrace
        ? parseInt(options.spansPerTrace, 10)
        : modeConfig.defaultSpansPerTrace,
      duration: 0,
      reportPath: options.report ?? null,
    };

    await runStressTest(config);
  });

program
  .command('verify')
  .description('Verify traces from a stress test report exist in LangWatch')
  .requiredOption('--report <path>', 'Path to the stress test report file')
  .action(async (options) => {
    try {
      const result = await runVerification(options.report);
      printVerificationResult(result);

      if (result.tracesMissing > 0 || result.spansMissing > 0) {
        process.exit(1);
      }
    } catch (error) {
      console.error('Verification failed:', error);
      process.exit(1);
    }
  });

program.parse();
