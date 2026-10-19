/**
 * @vitest-environment jsdom
 *
 * See ADR-058 and specs/ui/browser-errors.feature.
 */
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { describe, expect, it } from "vitest";

import { UrlScrubSpanProcessor } from "./urlScrubSpanProcessor.ts";

function exportedSpan({
  name = "documentLoad",
  attributes,
}: {
  name?: string;
  attributes: Record<string, string>;
}) {
  const exporter = new InMemorySpanExporter();
  const provider = new WebTracerProvider({
    spanProcessors: [new UrlScrubSpanProcessor(), new SimpleSpanProcessor(exporter)],
  });
  const span = provider.getTracer("test").startSpan(name);
  span.setAttributes(attributes);
  span.end();
  return exporter.getFinishedSpans()[0];
}

const exportedAttributes = (attributes: Record<string, string>) =>
  exportedSpan({ attributes })?.attributes;

describe("UrlScrubSpanProcessor", () => {
  describe("given a page load or fetch span records a URL with a query string", () => {
    /** @scenario Page loads and fetches export their URLs without query strings */
    it("exports the URL without its query string or fragment", () => {
      const attributes = exportedAttributes({
        "url.full": "https://app.test/reset-password?token=secret#step",
        "http.url": "/api/trpc/traces.list?input=%7B%22q%22%3A%22jane%22%7D",
        "url.query": "token=secret",
        "http.request.method": "GET",
      });

      expect(attributes).toEqual({
        "url.full": "https://app.test/reset-password",
        "http.url": "/api/trpc/traces.list",
        "http.request.method": "GET",
      });
    });
  });

  describe("given a span names a share link's path", () => {
    /** @scenario "Browser telemetry names a share link by its route" */
    it("exports the share path as /share/:id in the name and every string attribute", () => {
      const span = exportedSpan({
        name: "navigation /share/abc123def",
        attributes: {
          "http.url": "https://app.test/share/abc123def?view=spans",
          "url.full": "https://app.test/share/abc123def/",
          "url.path": "/share/abc123def",
          "navigation.from_path": "/share/:id",
        },
      });

      expect(span?.name).toBe("navigation /share/:id");
      expect(span?.attributes).toEqual({
        "http.url": "https://app.test/share/:id",
        "url.full": "https://app.test/share/:id/",
        "url.path": "/share/:id",
        "navigation.from_path": "/share/:id",
      });
    });
  });
});
