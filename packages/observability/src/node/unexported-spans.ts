import type { Context } from "@opentelemetry/api";
import type { ReadableSpan, Span, SpanProcessor } from "@opentelemetry/sdk-trace-base";

/**
 * The processor a process installs when it records spans and sends them
 * nowhere.
 *
 * A process with no LangWatch credentials still wants OpenTelemetry: the trace
 * id of the span a line happened under is what lets a developer pick one
 * request out of five interleaved lanes in a `pnpm dev` terminal, and it is
 * stamped onto every log record from the active span. What that process does
 * NOT want is an exporter, and the SDK could not tell the difference — with
 * nothing to export to and no processor of any kind, it wrote a nine-line
 * ERROR on every boot of every lane telling the deployment it had been
 * misconfigured.
 *
 * It had a point about the shape: a setup with no processors really is
 * indistinguishable from one whose exporter was forgotten. So the intent is
 * declared instead of argued with. Installing this says, in the one place the
 * SDK looks, that the spans are recorded for correlation and go no further.
 *
 * It holds nothing: a span reaches `onEnd` and is dropped there.
 */
export class UnexportedSpanProcessor implements SpanProcessor {
  onStart(_span: Span, _parentContext: Context): void {}

  onEnd(_span: ReadableSpan): void {}

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
