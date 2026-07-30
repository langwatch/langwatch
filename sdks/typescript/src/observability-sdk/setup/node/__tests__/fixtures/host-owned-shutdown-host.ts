// Fixture run as a real child process by signal-shutdown.unit.test.ts. Mimics
// how platform/app/src/instrumentation.node.ts + start.ts actually integrate:
// the HOST owns its own SIGTERM handler and its own process.exit, doing its
// own (slow) cleanup before calling the SDK's shutdown(). Proves that
// pattern flushes exactly once and terminates with the host's own chosen
// code — the SDK must never also react to the same signal and re-raise it,
// or a still-in-flight host handler (using `on`, not `once`, same as real
// app code) would be invoked a second time mid-cleanup.
import { setTimeout as delay } from "node:timers/promises";
import { setupObservability } from "../../index";
import { type Context } from "@opentelemetry/api";
import { type ReadableSpan, type Span, type SpanProcessor } from "@opentelemetry/sdk-trace-base";

class MarkerSpanProcessor implements SpanProcessor {
  onStart(_span: Span, _context: Context): void {
    // no spans are created; only shutdown() matters for this fixture
  }
  onEnd(_span: ReadableSpan): void {
    // no spans are created; only shutdown() matters for this fixture
  }
  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
  shutdown(): Promise<void> {
    process.stdout.write("FLUSHED\n");
    return Promise.resolve();
  }
}

const handle = setupObservability({
  langwatch: "disabled",
  spanProcessors: [new MarkerSpanProcessor()],
  debug: { logLevel: "error" },
});

let handlerRuns = 0;
process.on("SIGTERM", () => {
  void (async () => {
    handlerRuns += 1;
    process.stdout.write(`HANDLER_RUN:${handlerRuns}\n`);
    // Its own (unrelated) graceful-shutdown work, wide enough that a
    // same-signal re-raise from the SDK — if it happened — would land while
    // this first run is still in flight, proving a re-raise double-fires it.
    await delay(300);
    await handle.shutdown();
    process.exit(91);
  })();
});

process.stdout.write("READY\n");

setInterval(() => {
  // keep the loop alive until the host's own SIGTERM handler exits it
}, 1 << 30);
