/**
 * @vitest-environment node
 * `POST /api/rum/v1/traces` over the installed app, the collector stubbed at `fetch`.
 */
import { canonicalErrorResponse, createRestRuntime } from "@langwatch/api/rest";
import { RUM_MAX_BODY_BYTES, RUM_SERVICE_NAME } from "@langwatch/react-rum/constants";
import { RumApi } from "@langwatch/rum-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  COLLECTOR_ENDPOINT,
  exportWith,
  rumInstallation,
} from "../../app/__tests__/rum.fixture.ts";
import { rumRest } from "../rum.rest.ts";

async function door({
  hasCollector = true,
  collectorHeaders,
}: Readonly<{ hasCollector?: boolean; collectorHeaders?: string }> = {}) {
  const collector = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 200 }),
  );
  vi.stubGlobal("fetch", collector);
  const runtime = await rumInstallation({
    collectorEndpoint: hasCollector ? COLLECTOR_ENDPOINT : undefined,
    collectorHeaders,
  }).boot();
  const api = runtime.service(RumApi);
  const hono = createRestRuntime({
    identity: {
      authenticate: () => {
        throw new Error("The ingest door is public.");
      },
      identify: () => ({ actor: null, scope: null }),
    },
  }).mount(rumRest.router(), { app: () => api, onError: canonicalErrorResponse });

  return {
    collector,
    post: (body: string, headers: Record<string, string> = {}) =>
      hono.fetch(
        new Request("http://api.test/api/rum/v1/traces", {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body,
        }),
      ),
  };
}

function urlOf(input: RequestInfo | URL | undefined): string | undefined {
  if (input instanceof URL) return input.href;
  if (typeof input === "string") return input;
  return input?.url;
}

function forwarded(
  collector: ReturnType<
    typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>
  >,
) {
  const [input, init] = collector.mock.calls[0] ?? [];
  const body = init?.body;
  return {
    url: urlOf(input),
    headers: new Headers(init?.headers),
    body: typeof body === "string" ? JSON.parse(body) : undefined,
  };
}

describe("POST /api/rum/v1/traces", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("given a collector that expects a bearer token", () => {
    /** @scenario "An accepted report is forwarded with the collector's headers" */
    it("answers 202 and forwards to the traces address with the configured headers", async () => {
      const { collector, post } = await door({
        collectorHeaders: "Authorization=Bearer abc123,x-scope=team",
      });

      const response = await post(exportWith(1), { "x-langwatch-rum-session": "visit-1" });

      expect(response.status).toBe(202);
      expect(await response.text()).toBe("");
      await vi.waitFor(() => expect(collector).toHaveBeenCalledOnce());
      const sent = forwarded(collector);
      expect(sent.url).toBe(`${COLLECTOR_ENDPOINT}/v1/traces`);
      expect(sent.headers.get("authorization")).toBe("Bearer abc123");
      expect(sent.headers.get("x-scope")).toBe("team");
      expect(sent.headers.get("content-type")).toBe("application/json");
      expect(sent.body.resourceSpans[0].resource.attributes).toContainEqual({
        key: "service.name",
        value: { stringValue: RUM_SERVICE_NAME },
      });
    });
  });

  describe("given a deployment that names no collector", () => {
    it("answers 404 rum_ingest_disabled", async () => {
      const { collector, post } = await door({ hasCollector: false });

      const response = await post(exportWith(1));

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: "rum_ingest_disabled" });
      expect(collector).not.toHaveBeenCalled();
    });
  });

  describe("when the body is over the byte cap", () => {
    /** @scenario "A report over the byte cap is refused before it is read whole" */
    it("answers 413 rum_payload_too_large and forwards nothing", async () => {
      const { collector, post } = await door();

      const response = await post("x".repeat(RUM_MAX_BODY_BYTES + 1_000));

      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({ code: "rum_payload_too_large" });
      expect(collector).not.toHaveBeenCalled();
    });
  });

  describe("when the body is not an OTLP export", () => {
    it("answers 400 rum_payload_invalid", async () => {
      const { post } = await door();

      const response = await post("<html>");

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "rum_payload_invalid" });
    });
  });
});
