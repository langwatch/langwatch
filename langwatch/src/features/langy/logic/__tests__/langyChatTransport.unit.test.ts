/**
 * The Langy chat transport is the browser's critical turn-start path (S2 D): it
 * chooses create vs continue, adopts the ids the server mints, and surfaces a
 * rejected turn-start to `useChat().error`. These lock that contract at the
 * transport boundary — the tRPC client and the onTurnStream subscription are
 * mocked so only the transport's own decisions are under test.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Unsubscribable } from "@trpc/server/observable";
import {
  createLangyChatTransport,
  type LangyChatTransportDeps,
  type LangyTurnRequestContext,
} from "../langyChatTransport";

const mutation = vi.fn();
const subscription = vi.fn<
  (path: string, input: unknown, opts: unknown) => Unsubscribable
>(() => ({ unsubscribe: vi.fn() }));

// The mock mirrors tRPC's real `TRPCUntypedClient`, whose `mutation`/`subscription`
// run `this.requestAsPromise(...)` internally (see @trpc/client dist). Modelling
// that `this` dependency is load-bearing: a transport that DETACHES the method
// (`const m = trpcClient.mutation; m(...)`) loses `this` and throws
// "Cannot read properties of undefined (reading 'requestAsPromise')" — the exact
// crash that shipped. A bare `vi.fn()` (no `this`) would silently hide it, which
// is how it slipped through before. Each method touches `this.requestAsPromise`
// the way the real client does, then delegates to the spy for assertions.
vi.mock("~/utils/api", () => ({
  trpcClient: {
    requestAsPromise: true,
    mutation(path: string, input: unknown) {
      void (this as { requestAsPromise: unknown }).requestAsPromise;
      return mutation(path, input);
    },
    subscription(path: string, input: unknown, opts: unknown) {
      void (this as { requestAsPromise: unknown }).requestAsPromise;
      return subscription(path, input, opts);
    },
  },
}));

function makeTransport(
  context: Partial<LangyTurnRequestContext> = {},
  over: Partial<LangyChatTransportDeps> = {},
) {
  const onIds = vi.fn();
  const deps: LangyChatTransportDeps = {
    getContext: () => ({
      projectId: "p1",
      conversationId: null,
      ...context,
    }),
    onIds,
    onSignal: vi.fn(),
    onTurnSettled: vi.fn(),
    ...over,
  };
  return { transport: createLangyChatTransport(deps), onIds };
}

const options = (over: Record<string, unknown> = {}) =>
  ({
    messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] }],
    ...over,
  }) as unknown as Parameters<
    ReturnType<typeof createLangyChatTransport>["sendMessages"]
  >[0];

describe("createLangyChatTransport", () => {
  beforeEach(() => {
    mutation.mockReset();
    mutation.mockResolvedValue({ conversationId: "conv-1", turnId: "turn-1" });
    subscription.mockClear();
  });

  describe("given no conversation id yet (a fresh conversation)", () => {
    it("starts the turn via langy.createConversation and adopts the minted ids", async () => {
      const { transport, onIds } = makeTransport({ conversationId: null });
      await transport.sendMessages(options());

      expect(mutation).toHaveBeenCalledTimes(1);
      const [path, input] = mutation.mock.calls[0]!;
      expect(path).toBe("langy.createConversation");
      expect(input).not.toHaveProperty("conversationId");
      expect(input).toMatchObject({ projectId: "p1" });
      expect(onIds).toHaveBeenCalledWith({
        conversationId: "conv-1",
        turnId: "turn-1",
      });
    });
  });

  describe("given an active conversation id", () => {
    it("continues via langy.continueConversation carrying that conversation id", async () => {
      const { transport } = makeTransport({ conversationId: "conv-active" });
      await transport.sendMessages(options());

      const [path, input] = mutation.mock.calls[0]!;
      expect(path).toBe("langy.continueConversation");
      expect(input).toMatchObject({ conversationId: "conv-active" });
    });
  });

  describe("given per-send context (model override + composer chips)", () => {
    it("threads only the present fields onto the turn input", async () => {
      const { transport } = makeTransport({
        conversationId: null,
        modelOverride: "openai/gpt-5-mini",
        pageContext: [{ kind: "trace", id: "t-1" }] as never,
        skills: [],
      });
      await transport.sendMessages(options({ trigger: "submit-message" }));

      const [, input] = mutation.mock.calls[0]!;
      expect(input).toMatchObject({
        modelOverride: "openai/gpt-5-mini",
        trigger: "submit-message",
        pageContext: [{ kind: "trace", id: "t-1" }],
      });
      // An empty skills array is omitted, not sent as [].
      expect(input).not.toHaveProperty("skills");
    });
  });

  describe("given the turn-start mutation rejects", () => {
    it("propagates the error to useChat and never subscribes to a stream", async () => {
      mutation.mockRejectedValue(new Error("boom"));
      const { transport, onIds } = makeTransport({ conversationId: null });

      await expect(transport.sendMessages(options())).rejects.toThrow("boom");
      expect(onIds).not.toHaveBeenCalled();
      expect(subscription).not.toHaveBeenCalled();
    });
  });

  describe("given the tRPC client method depends on its `this` binding", () => {
    it("keeps the mutation call attached to trpcClient so a send never throws the detached-`this` TypeError", async () => {
      // Regression: the transport shipped `const mutate = trpcClient.mutation`,
      // which drops `this`. The first send then threw synchronously with
      // "Cannot read properties of undefined (reading 'requestAsPromise')" —
      // before any request left the browser (no network, generic error card).
      // Reverting the transport to a detached reference makes this (and every
      // other send test) throw against the `this`-faithful mock above.
      const { transport, onIds } = makeTransport({ conversationId: null });

      // Must RESOLVE. A detached call rejects with the TypeError instead.
      await expect(transport.sendMessages(options())).resolves.toBeDefined();
      expect(mutation).toHaveBeenCalledTimes(1);
      expect(onIds).toHaveBeenCalledWith({
        conversationId: "conv-1",
        turnId: "turn-1",
      });
      // And it got far enough to open the live stream.
      expect(subscription).toHaveBeenCalledTimes(1);
    });
  });

  describe("reconnectToStream", () => {
    it("returns null — resume is a panel-driven re-subscribe, not a transport reconnect", async () => {
      const { transport } = makeTransport();
      await expect(transport.reconnectToStream!(options())).resolves.toBeNull();
    });
  });
});
