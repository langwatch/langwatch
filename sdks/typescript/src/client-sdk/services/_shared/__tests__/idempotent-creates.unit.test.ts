/**
 * Retrying a create is the one retry a caller cannot make safe alone: a
 * dropped connection after the write looks exactly like a dropped request, and
 * sending it again mints a second key, budget or endpoint. `idempotencyKey` is
 * how the caller says "these two are the same request", and it is worth
 * nothing unless the SDK actually puts it on the wire.
 *
 * All three creates are exercised here rather than once per service, because
 * the failure this guards against is one surface quietly not sending it.
 *
 * Spec: specs/ai-gateway/idempotency.feature
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { GatewayBudgetsApiService } from "../../gateway-budgets/gateway-budgets-api.service";
import { VirtualKeysApiService } from "../../virtual-keys/virtual-keys-api.service";
import { WebhooksApiService } from "../../webhooks/webhooks-api.service";
import { IDEMPOTENCY_KEY_HEADER, IDEMPOTENT_REPLAY_HEADER } from "../mutation-options";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const jsonResponse = (body: unknown, init?: { status?: number; replayed?: boolean }): Response =>
  new Response(JSON.stringify(body), {
    status: init?.status ?? 201,
    headers: {
      "content-type": "application/json",
      ...(init?.replayed ? { [IDEMPOTENT_REPLAY_HEADER]: "true" } : {}),
    },
  });

/** The headers of one recorded call, however fetch was handed them. */
const headersOf = (call: number): Headers =>
  new Headers((mockFetch.mock.calls[call]?.[1] as RequestInit | undefined)?.headers);

const bodyOf = (call: number): string =>
  (mockFetch.mock.calls[call]?.[1] as RequestInit).body as string;

/**
 * The three creates the control plane deduplicates, each with the body it
 * takes and the envelope it answers with.
 */
const CREATES = [
  {
    surface: "virtual keys",
    response: { virtual_key: { id: "vk_1" }, secret: "sk-vk-1" },
    create: (options?: Parameters<VirtualKeysApiService["create"]>[1]) =>
      new VirtualKeysApiService({ apiKey: "sk-lw-test" }).create({ name: "checkout" }, options),
    idOf: (result: unknown) => (result as { virtual_key: { id: string } }).virtual_key.id,
    expectedId: "vk_1",
  },
  {
    surface: "gateway budgets",
    response: { budget: { id: "bg_1" } },
    create: (options?: Parameters<GatewayBudgetsApiService["create"]>[1]) =>
      new GatewayBudgetsApiService({ apiKey: "sk-lw-test" }).create(
        {
          scope: { kind: "project", project_id: "p_1" },
          name: "monthly",
          window: "month",
          limit_usd: "10",
        },
        options,
      ),
    idOf: (result: unknown) => (result as { id: string }).id,
    expectedId: "bg_1",
  },
  {
    surface: "webhook endpoints",
    response: { data: { id: "we_1", secret: "whsec_1" } },
    create: (options?: Parameters<WebhooksApiService["create"]>[1]) =>
      new WebhooksApiService({ apiKey: "sk-lw-test" }).create(
        { url: "https://acme.example/hooks", enabled_events: ["a"] },
        options,
      ),
    idOf: (result: unknown) => (result as { id: string }).id,
    expectedId: "we_1",
  },
] as const;

describe("Feature: retrying a create without minting a duplicate", () => {
  const previousApiKey = process.env.LANGWATCH_API_KEY;
  const previousEndpoint = process.env.LANGWATCH_ENDPOINT;

  beforeEach(() => {
    mockFetch.mockReset();
    process.env.LANGWATCH_API_KEY = "sk-lw-test";
    process.env.LANGWATCH_ENDPOINT = "https://app.langwatch.test";
  });

  afterEach(() => {
    process.env.LANGWATCH_API_KEY = previousApiKey;
    process.env.LANGWATCH_ENDPOINT = previousEndpoint;
  });

  describe.each(CREATES)("given a create on $surface", (surface) => {
    describe("when a caller supplies an idempotency key", () => {
      it("sends it as the Idempotency-Key header", async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse(surface.response));

        await surface.create({ idempotencyKey: "key-abc" });

        expect(headersOf(0).get(IDEMPOTENCY_KEY_HEADER)).toBe("key-abc");
      });

      it("leaves the request body untouched", async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse(surface.response));

        await surface.create({ idempotencyKey: "key-abc" });

        // The key travels in a header. A body that grew a field would be
        // rejected by the server's validator, or worse, silently stripped.
        expect(bodyOf(0)).not.toContain("key-abc");
        expect(bodyOf(0)).not.toContain("idempotency");
      });
    });

    describe("when no idempotency key is supplied", () => {
      it("sends no header at all, leaving the unkeyed path untouched", async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse(surface.response));

        await surface.create();

        expect(headersOf(0).has(IDEMPOTENCY_KEY_HEADER)).toBe(false);
      });
    });

    describe("when the same key is sent twice", () => {
      it("hands back the same resource both times", async () => {
        mockFetch
          .mockResolvedValueOnce(jsonResponse(surface.response))
          .mockResolvedValueOnce(jsonResponse(surface.response, { replayed: true }));

        const first = await surface.create({ idempotencyKey: "key-abc" });
        const second = await surface.create({ idempotencyKey: "key-abc" });

        expect(surface.idOf(first)).toBe(surface.expectedId);
        expect(surface.idOf(second)).toBe(surface.expectedId);
        expect(headersOf(1).get(IDEMPOTENCY_KEY_HEADER)).toBe("key-abc");
      });

      it("tells a caller who asked that the second answer was a replay", async () => {
        mockFetch
          .mockResolvedValueOnce(jsonResponse(surface.response))
          .mockResolvedValueOnce(jsonResponse(surface.response, { replayed: true }));
        const replays = vi.fn();

        await surface.create({
          idempotencyKey: "key-abc",
          onIdempotentReplay: replays,
        });
        // A first execution carries no header at all, so nothing fires.
        expect(replays).not.toHaveBeenCalled();

        await surface.create({
          idempotencyKey: "key-abc",
          onIdempotentReplay: replays,
        });
        expect(replays).toHaveBeenCalledTimes(1);
      });
    });

    describe("when the caller cancels", () => {
      it("passes its own signal rather than the SDK's timeout", async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse(surface.response));
        const controller = new AbortController();

        await surface.create({ signal: controller.signal });

        expect((mockFetch.mock.calls[0]?.[1] as RequestInit).signal).toBe(controller.signal);
      });
    });
  });
});
