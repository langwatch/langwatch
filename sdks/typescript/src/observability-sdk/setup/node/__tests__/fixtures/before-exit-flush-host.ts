// Fixture run as a real child process by signal-shutdown.unit.test.ts. Proves
// the SDK still flushes on a natural process end (event loop drains, no
// signal involved) — the one case where the SDK acting on its own is safe,
// since it never decides whether or how the process exits.
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

setupObservability({
  langwatch: "disabled",
  spanProcessors: [new MarkerSpanProcessor()],
  debug: { logLevel: "error" },
});

process.stdout.write("READY\n");

// Nothing keeps the loop alive — it drains naturally right after this,
// firing beforeExit without any signal being sent.
