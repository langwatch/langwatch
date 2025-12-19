import { program } from 'commander';
import { performance } from 'perf_hooks';
import { BatchSpanProcessor, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { setupObservability } from 'langwatch/observability/node';
import { getLangWatchTracer, LangWatchTraceExporter } from 'langwatch/observability';
import 'dotenv/config';

setupObservability({
  attributes: {
    "service.name": "langwatch-backend",
    "deployment.environment": process.env.ENVIRONMENT,
  },
  spanProcessors: [new BatchSpanProcessor(new LangWatchTraceExporter({ filters: null }))],
  sampler: new TraceIdRatioBasedSampler(1.0),
});

const tracer = getLangWatchTracer("stress-test-tracer");

program
  .name('stressed-n-blessed')
  .description('Stress test OTLP traces endpoint with spans and traces')
  .version('1.0.0')
  .option('-t, --traces <number>', 'Number of traces to generate', '1000')
  .option('-d, --depth <number>', 'Maximum depth of nested spans', '30')
  .option('-s, --spans-per-trace <number>', 'Average spans per trace', '30')
  .option('--duration <seconds>', 'Test duration in seconds (0 for unlimited)', '120')
  .option('--json', 'Send JSON format instead of protobuf')
  .parse();

const options = program.opts();

// Configuration
const config = {
  totalTraces: parseInt(options.traces),
  maxDepth: parseInt(options.depth),
  avgSpansPerTrace: parseInt(options.spansPerTrace),
  duration: parseInt(options.duration),
  useJson: options.json
};

// Global state
let stats = {
  requestsSent: 0,
  tracesSent: 0,
  spansSent: 0,
  errors: 0,
  startTime: performance.now(),
  endTime: 0
};

// Function to create spans for a trace (simplified to avoid validation issues)
function createSpansForTrace(traceIndex: number, spansToCreate: number): number {
  const traceId = `trace-${traceIndex}-${Date.now()}`;

  for (let i = 0; i < spansToCreate; i++) {
    const spanName = `span-${traceIndex}-${i}`;
    const span = tracer.startSpan(spanName, {
      kind: SpanKind.INTERNAL,
      attributes: {
        'stress-test.trace-id': traceId,
        'stress-test.trace-index': traceIndex,
        'stress-test.span-index': i,
        'stress-test.type': 'test-span'
      }
    });

    // Add some mock attributes
    span.setAttributes({
      'stress-test.operation': `operation-${i}`,
      'stress-test.duration': Math.floor(Math.random() * 1000) + 100,
      'stress-test.success': Math.random() > 0.05 // 95% success rate
    });

    // End span immediately
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
  }

  return spansToCreate;
}

// Function to create a complete trace
function createTrace(traceIndex: number): void {
  // Determine how many spans to create for this trace
  const spansForThisTrace = Math.max(
    1,
    Math.floor(config.avgSpansPerTrace * (0.5 + Math.random())) // Vary around the average
  );

  console.log(`Creating trace ${traceIndex} with ${spansForThisTrace} spans`);

  // Create spans for this trace (simplified approach)
  const spansCreated = createSpansForTrace(traceIndex, spansForThisTrace);

  console.log(`Trace ${traceIndex} completed: created ${spansCreated} spans`);

  stats.tracesSent++;
  stats.spansSent += spansCreated;
}

// Main stress test function
async function runStressTest(): Promise<void> {
  console.log(`Starting stress test with ${config.totalTraces} traces...`);
  console.log(`Configuration:`, config);

  const promises: Promise<void>[] = [];

  for (let i = 0; i < config.totalTraces; i++) {
    // Add some delay between trace creation to simulate real traffic patterns
    const delay = Math.floor(Math.random() * 100);
    promises.push(
      new Promise(resolve => {
        setTimeout(() => {
          createTrace(i);
          resolve();
        }, delay);
      })
    );
  }

  await Promise.all(promises);

  // Wait for all spans to be sent
  await new Promise(resolve => setTimeout(resolve, 2000));

  stats.endTime = performance.now();
  const duration = (stats.endTime - stats.startTime) / 1000;

  console.log(`\nStress test completed:`);
  console.log(`- Duration: ${duration.toFixed(2)}s`);
  console.log(`- Traces sent: ${stats.tracesSent}`);
  console.log(`- Spans sent: ${stats.spansSent}`);
  console.log(`- Average spans per trace: ${(stats.spansSent / stats.tracesSent).toFixed(2)}`);
  console.log(`- Throughput: ${(stats.spansSent / duration).toFixed(2)} spans/second`);

  // Wait for all spans to calm down
  await new Promise(resolve => setTimeout(resolve, 10000));
}

runStressTest().catch(console.error);
