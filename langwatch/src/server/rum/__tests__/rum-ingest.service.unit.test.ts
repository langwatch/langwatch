/**
 * @vitest-environment node
 *
 * Binds the ingest scenarios in
 * specs/observability/browser-rum-trace-correlation.feature — the ones about
 * treating the payload as untrusted. See ADR-058.
 *
 * The route is public and unauthenticated by necessity, so these tests are
 * written from the attacker's side: what does a hostile payload cost us, and
 * what can it claim to be?
 */
import { RUM_MAX_BODY_BYTES, RUM_SERVICE_NAME } from "@langwatch/react-rum";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  collectorHeaders,
  countSpans,
  ingestBrowserTraces,
  type OtlpResourceSpans,
  readCappedBody,
  RUM_PER_CALLER_PER_MINUTE,
  RumPayloadInvalidError,
  RumPayloadTooLargeError,
  RumRateLimitedError,
  stampIdentity,
} from "../rum-ingest.service";

const attribute = (key: string, value: string) => ({
  key,
  value: { stringValue: value },
});

const exportWith = (spanCount: number, attributes = [attribute("service.name", RUM_SERVICE_NAME)]) =>
  JSON.stringify({
    resourceSpans: [
      {
        resource: { attributes },
        scopeSpans: [{ spans: Array.from({ length: spanCount }, () => ({})) }],
      },
    ],
  });

const requestWith = ({
  body,
  contentLength,
}: {
  body: string;
  contentLength?: string;
}) =>
  new Request("https://example.test/api/rum/v1/traces", {
    method: "POST",
    headers: contentLength ? { "content-length": contentLength } : {},
    body,
  });

describe("given a browser posting telemetry", () => {
  beforeEach(() => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://collector.test:4318";
    delete process.env.OTEL_EXPORTER_OTLP_HEADERS;
    vi.restoreAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
  });

  describe("when the body is larger than the cap", () => {
    it("refuses without buffering the whole body", async () => {
      // The declared length lies, which is the point: a real attacker sends a
      // small content-length (or none at all, chunked) and a huge body.
      const oversized = "x".repeat(RUM_MAX_BODY_BYTES + 1_000);

      await expect(
        readCappedBody(requestWith({ body: oversized, contentLength: "100" })),
      ).rejects.toBeInstanceOf(RumPayloadTooLargeError);
    });

    it("refuses on the declared length alone when it is honest", async () => {
      await expect(
        readCappedBody(
          requestWith({
            body: "small",
            contentLength: String(RUM_MAX_BODY_BYTES + 1),
          }),
        ),
      ).rejects.toBeInstanceOf(RumPayloadTooLargeError);
    });

    it("counts bytes rather than characters", async () => {
      // Every one of these is 3 bytes in UTF-8 but 1 JS string unit, so a
      // length check on the decoded string passes something 3x over the cap.
      const multibyte = "☃".repeat(RUM_MAX_BODY_BYTES / 2);

      await expect(
        readCappedBody(requestWith({ body: multibyte })),
      ).rejects.toBeInstanceOf(RumPayloadTooLargeError);
    });
  });

  describe("when the payload carries more spans than the cap", () => {
    it("refuses even though the body is small", async () => {
      const many = exportWith(5_000);
      expect(many.length).toBeLessThan(RUM_MAX_BODY_BYTES);

      await expect(
        ingestBrowserTraces({ body: many, callerKey: "spans" }),
      ).rejects.toBeInstanceOf(RumPayloadTooLargeError);
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe("when the payload claims to be another service", () => {
    it("overwrites the claim instead of trusting it", async () => {
      const forged = [
        attribute("service.name", RUM_SERVICE_NAME),
        // Appended second: collectors take the last value, so a first-match
        // check would pass this through as langwatch-app.
        attribute("service.name", "langwatch-app"),
      ];

      await ingestBrowserTraces({
        body: exportWith(1, forged),
        callerKey: "forger",
      });

      const forwarded = JSON.parse(
        (vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).body as string,
      ) as { resourceSpans: OtlpResourceSpans[] };
      const names = forwarded.resourceSpans[0]?.resource?.attributes?.filter(
        (a) => a.key === "service.name",
      );
      expect(names).toHaveLength(1);
      expect(names?.[0]?.value?.stringValue).toBe(RUM_SERVICE_NAME);
    });
  });

  describe("when the payload sets its own origin marker", () => {
    it("replaces it, so the marker cannot be forged or omitted", () => {
      const resourceSpans: OtlpResourceSpans[] = [
        {
          resource: {
            attributes: [attribute("langwatch.origin", "customer_data")],
          },
        },
      ];

      stampIdentity(resourceSpans);

      const origins = resourceSpans[0]?.resource?.attributes?.filter(
        (a) => a.key === "langwatch.origin",
      );
      expect(origins).toHaveLength(1);
      expect(origins?.[0]?.value?.stringValue).toBe("platform_internal");
    });
  });

  describe("when a caller floods the route", () => {
    it("throttles them even as they rotate their claimed identity", async () => {
      // Rotating the session header lands every request in a fresh per-caller
      // bucket, which is why a global bucket exists. Drive one caller past its
      // own limit first to prove the per-caller bucket bites at all.
      const attempts = RUM_PER_CALLER_PER_MINUTE + 5;
      let refusals = 0;
      for (let i = 0; i < attempts; i++) {
        try {
          await ingestBrowserTraces({ body: exportWith(1), callerKey: "flood" });
        } catch (error) {
          if (error instanceof RumRateLimitedError) refusals++;
        }
      }
      expect(refusals).toBeGreaterThan(0);
    });
  });

  describe("when the body is not a usable OTLP export", () => {
    it.each([
      ["not json at all", "<html>"],
      ["json with no resourceSpans", "{}"],
      ["an empty resourceSpans list", '{"resourceSpans":[]}'],
      ["resourceSpans carrying no spans", '{"resourceSpans":[{"resource":{}}]}'],
    ])("refuses %s", async (_case, body) => {
      await expect(
        ingestBrowserTraces({ body, callerKey: `invalid-${_case}` }),
      ).rejects.toBeInstanceOf(RumPayloadInvalidError);
    });
  });

  describe("when the collector is unreachable", () => {
    it("accepts the report rather than inviting the browser to retry", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("connect ECONNREFUSED");
        }),
      );

      // A 5xx here is retryable to an OTLP exporter, so surfacing the failure
      // would turn a collector outage into a retry storm against our own app.
      await expect(
        ingestBrowserTraces({ body: exportWith(1), callerKey: "unreachable" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when the collector expects a bearer token", () => {
    it("forwards the configured headers", () => {
      process.env.OTEL_EXPORTER_OTLP_HEADERS =
        "Authorization=Bearer abc123,x-scope=team";

      const headers = collectorHeaders();

      expect(headers.authorization).toBe("Bearer abc123");
      expect(headers["x-scope"]).toBe("team");
      expect(headers["content-type"]).toBe("application/json");
    });
  });
});

describe("given an export spread across resources and scopes", () => {
  it("counts every span in it", () => {
    const resourceSpans: OtlpResourceSpans[] = [
      { scopeSpans: [{ spans: [{}, {}] }, { spans: [{}] }] },
      { scopeSpans: [{ spans: [{}] }] },
      { scopeSpans: [{}] },
    ];

    expect(countSpans(resourceSpans)).toBe(4);
  });
});
