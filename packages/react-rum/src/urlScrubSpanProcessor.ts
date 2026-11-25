// Page-load and fetch spans record full URLs; reset links, invite tokens and tRPC GET inputs
// ride in the query, and a share link in the path. This drops every query string and fragment
// and names share paths `/share/:id` in span names and string attributes before export.

import type { Context } from "@opentelemetry/api";
import type { ReadableSpan, Span, SpanProcessor } from "@opentelemetry/sdk-trace-base";

import { redactSharePaths, stripUrlQueries } from "./browserErrors.ts";

const QUERY_ATTRIBUTES = ["url.query", "url.fragment"];

export class UrlScrubSpanProcessor implements SpanProcessor {
  onStart(_span: Span, _parentContext: Context): void {
    // URLs are set during the span's life, so they are scrubbed at its end.
  }

  onEnding(span: Span): void {
    // The last moment the name can still change; `onEnd` sees a frozen span.
    span.updateName(redactSharePaths({ value: span.name }));
  }

  onEnd(span: ReadableSpan): void {
    const attributes = span.attributes;
    for (const key of QUERY_ATTRIBUTES) delete attributes[key];
    for (const [key, value] of Object.entries(attributes)) {
      if (typeof value === "string") {
        attributes[key] = redactSharePaths({ value: stripUrlQueries({ value }) });
      }
    }
  }

  async forceFlush(): Promise<void> {
    // Holds no buffer of its own.
  }

  async shutdown(): Promise<void> {
    // Holds no resources of its own.
  }
}
