/**
 * Stamps every span with the session it belongs to.
 *
 * A processor rather than a resource attribute because the session rotates
 * while the page is open — a resource is fixed for the lifetime of the
 * provider, so a long-lived tab would report its first session forever.
 *
 * See ADR-058.
 */

import type { Context } from "@opentelemetry/api";
import type { ReadableSpan, Span, SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { ATTR_SESSION_ID } from "@opentelemetry/semantic-conventions/incubating";

import { currentSessionId } from "./session";

export class SessionSpanProcessor implements SpanProcessor {
  onStart(span: Span, _parentContext: Context): void {
    const sessionId = currentSessionId();
    if (sessionId) span.setAttribute(ATTR_SESSION_ID, sessionId);
  }

  onEnd(_span: ReadableSpan): void {
    // Nothing to do: the attribute is set once, at start.
  }

  async forceFlush(): Promise<void> {
    // Holds no buffer of its own.
  }

  async shutdown(): Promise<void> {
    // Holds no resources of its own.
  }
}
