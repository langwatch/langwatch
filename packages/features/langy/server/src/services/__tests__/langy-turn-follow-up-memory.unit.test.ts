/**
 * THE "run it" BUG. The agent's memory of a conversation lives only inside its
 * live worker process, and that process is reaped after ten idle minutes,
 * killed when the turn's capabilities change, and gone whenever the fleet
 * rolls. The control plane must not send a turn nothing but the latest user
 * sentence, or "run it" arrives with no "it" in sight.
 *
 * These pin the plumbing: the conversation's own history and any resource it
 * touched reach the dispatched turn, whatever the worker does or does not
 * remember.
 *
 * Ported from platform/app/src/server/app-layer/langy/__tests__/langy-turn.service.unit.test.ts
 * (origin/main)'s "when a follow-up turn depends on what an earlier turn
 * created" block, adapted to the split `LangyTurnServiceDeps` fixture (see
 * langy-turn-preparation.service.unit.test.ts). See
 * specs/langy/langy-conversation-memory.feature.
 */
import type { LangyMessageRow } from "@langwatch/langy-contract";
import { describe, expect, it, vi } from "vitest";
import { LANGY_REFERENT_POLICY } from "../langy-conversation-memory.service";
import {
  LangyTurnService,
  type LangyTurnServiceDeps,
  type StartConversationTurnInput,
} from "../langy-turn.service";

function makeDeps(over: Partial<LangyTurnServiceDeps> = {}) {
  const dispatch = vi.fn(async () => "accepted" as const);
  const stash = vi.fn(async () => undefined);
  const findAllByConversation = vi.fn(async (): Promise<LangyMessageRow[]> => []);
  const probe = vi.fn(async () => false);

  const deps = {
    conversations: {
      ensureConversation: vi.fn(async () => ({ id: "conv-1", isNew: false })),
      tryFindByIdVisible: vi.fn(async () => null),
      tryGetPendingHandoff: vi.fn(async () => null),
      tryGetRunToken: vi.fn(async () => "run-token"),
      acceptTurn: vi.fn(async () => undefined),
      finalizeTurn: vi.fn(async () => undefined),
    },
    credentials: {
      getOrProvision: vi.fn(async () => ({ organizationId: "org-1" })),
      tryGetEgressAllowlist: vi.fn(async () => null),
      resolveMirrorTier: vi.fn(async () => "content" as const),
      tryGetModelsAllowed: vi.fn(async () => null),
    },
    models: { resolve: vi.fn(async () => ({ modelId: "openai/gpt-5-mini" })) },
    worker: { probe, dispatch, cancel: vi.fn(async () => undefined), warm: vi.fn(async () => undefined) },
    tokenBuffer: null,
    permits: {
      reserve: vi.fn(async () => ({ reserved: false, allowed: true, resetAt: 0 })),
      release: vi.fn(async () => undefined),
      check: vi.fn(async () => ({ allowed: true })),
    },
    perDayPrCap: 5,
    sessionKeys: { mint: vi.fn(async () => ({ token: "sk", apiKeyId: "key-1" })), revoke: vi.fn(async () => undefined) },
    context: { render: vi.fn(() => null) },
    metrics: { count: vi.fn() },
    admission: {
      claim: vi.fn(async () => ({
        kind: "claimed" as const,
        claimToken: "claim-1",
        conversationId: "conv-1",
        turnId: "turn-1",
      })),
      commit: vi.fn(async () => undefined),
      abort: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
    },
    accessStore: { grant: vi.fn(async () => undefined), isTurnActor: vi.fn(async () => true) },
    handoffStore: { stash },
    messages: { findAllByConversation },
    ...over,
  } as unknown as LangyTurnServiceDeps;

  return { deps, mocks: { dispatch, stash, findAllByConversation, probe } };
}

const input = (
  over: Partial<StartConversationTurnInput> = {},
): StartConversationTurnInput => ({
  projectId: "p1",
  idempotencyKey: "00000000-0000-4000-8000-000000000001",
  session: { user: { id: "user-1" } },
  requestedConversationId: null,
  messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
  isRetry: false,
  turnContext: {},
  ...over,
});

interface DispatchedTurn {
  system: string;
  prompt: string;
  historySeed?: string;
}
const dispatchedOf = (dispatch: ReturnType<typeof vi.fn>): DispatchedTurn =>
  dispatch.mock.calls[0]![0] as DispatchedTurn;

/** The tool part a scenario create leaves on the durable assistant message. */
const scenarioCreated: LangyMessageRow = {
  id: "m1",
  role: "assistant",
  parts: [
    {
      type: "tool-langwatch.scenario.create",
      toolCallId: "call-1",
      state: "output-available",
      digest: {
        resource: "scenario",
        verb: "create",
        strategy: "id-ref",
        primaryId: "scenario_0002E069Y90C5aaw1h325gUZ7TE0W",
        ids: ["scenario_0002E069Y90C5aaw1h325gUZ7TE0W"],
        name: "Customer support agent",
      },
    },
    { type: "text", text: "", role: "assistant" },
  ] as LangyMessageRow["parts"],
  createdAt: new Date(),
};

describe("LangyTurnService.startConversationTurn conversation memory", () => {
  /** @scenario A follow-up turn carries what earlier turns created */
  /** @scenario The memory survives the agent forgetting */
  it("hands the agent the id its own earlier turn produced", async () => {
    const { deps, mocks } = makeDeps();
    mocks.findAllByConversation.mockResolvedValue([scenarioCreated]);
    // A warm worker would still hold the session — the point is that this does
    // not depend on it: the seed rides the dispatch either way.
    mocks.probe.mockResolvedValue(true);

    await LangyTurnService.create(deps).startConversationTurn(
      input({ messages: [{ role: "user", parts: [{ type: "text", text: "run it" }] }] }),
    );

    const { historySeed } = dispatchedOf(mocks.dispatch);
    expect(historySeed).toContain("scenario_0002E069Y90C5aaw1h325gUZ7TE0W");
    expect(historySeed).toContain("Customer support agent");
    expect(mocks.findAllByConversation).toHaveBeenCalledWith({
      conversationId: "conv-1",
      projectId: "p1",
    });
  });

  /** @scenario Every turn carries the rule for resolving a bare reference */
  /** @scenario The data blocks arrive ahead of the message they explain */
  it("keeps the resolution rule in the stable instructions and the data ahead of the ask", async () => {
    const { deps, mocks } = makeDeps();
    mocks.findAllByConversation.mockResolvedValue([scenarioCreated]);

    await LangyTurnService.create(deps).startConversationTurn(
      input({
        turnContext: {
          pageContext: [{ kind: "trace", ref: "trace-abc", label: "trace abc" }],
        },
      }),
    );

    const { system, prompt } = dispatchedOf(mocks.dispatch);
    expect(system).toContain(LANGY_REFERENT_POLICY);
    // The screen-context DATA precedes the labelled ask inside the message, so
    // the model reads what "this trace" could mean before the words that may
    // say it. (No context renderer is wired in this fixture, so the label
    // itself is the one thing guaranteed to be present; the ordering is what
    // langy-context-attach.feature pins at the renderer.)
    expect(prompt.trimEnd().endsWith("hi")).toBe(true);
  });

  /** @scenario A follow-up turn carries the conversation so far */
  /** @scenario What was said survives the worker being replaced */
  /** @scenario Switching models mid-conversation keeps the conversation */
  it("carries the transcript seed so a fresh worker on another model continues the conversation", async () => {
    const { deps, mocks } = makeDeps();
    mocks.findAllByConversation.mockResolvedValue([
      {
        id: "t1",
        role: "user",
        parts: [{ type: "text", text: "my name is rogerio" }] as LangyMessageRow["parts"],
        createdAt: new Date(),
      },
      {
        id: "t2",
        role: "assistant",
        parts: [{ type: "text", text: "Nice to meet you, Rogerio!" }] as LangyMessageRow["parts"],
        createdAt: new Date(),
      },
    ]);
    // The model switch recycled the worker: the probe misses and this turn
    // runs on a fresh session that has never seen the conversation.
    mocks.probe.mockResolvedValue(false);

    await LangyTurnService.create(deps).startConversationTurn(
      input({
        modelOverride: "anthropic/claude-haiku-4-5",
        messages: [{ role: "user", parts: [{ type: "text", text: "what is my name?" }] }],
      }),
    );

    const { system, prompt, historySeed } = dispatchedOf(mocks.dispatch);
    expect(historySeed).toContain("THE CONVERSATION SO FAR");
    expect(historySeed).toContain("User: my name is rogerio");
    expect(historySeed).toContain("Langy: Nice to meet you, Rogerio!");
    // The volatile transcript must NOT ride the system lane: a per-turn system
    // re-write would bust the provider's cached prefix every turn.
    expect(system).not.toContain("THE CONVERSATION SO FAR");
    expect(historySeed?.trimEnd().endsWith("THE USER'S MESSAGE:")).toBe(true);
    expect(prompt).toBe("what is my name?");
    // The stash carries the same seed: an outbox or liveness re-dispatch to a
    // fresh worker continues the conversation too.
    const stashed = (mocks.stash.mock.calls[0] as unknown as [{ system: string; historySeed?: string }])[0];
    expect(stashed.historySeed).toBe(historySeed);
    expect(stashed.system).toBe(system);
  });

  /** @scenario Carrying the conversation does not defeat prompt caching */
  it("sends byte-identical instructions on consecutive turns of one conversation", async () => {
    const first = makeDeps();
    first.mocks.findAllByConversation.mockResolvedValue([scenarioCreated]);
    await LangyTurnService.create(first.deps).startConversationTurn(
      input({ messages: [{ role: "user", parts: [{ type: "text", text: "run it" }] }] }),
    );

    const second = makeDeps();
    second.mocks.findAllByConversation.mockResolvedValue([
      scenarioCreated,
      {
        id: "m2",
        role: "assistant",
        parts: [{ type: "text", text: "Ran it: all passed." }] as LangyMessageRow["parts"],
        createdAt: new Date(),
      },
    ]);
    await LangyTurnService.create(second.deps).startConversationTurn(
      input({
        idempotencyKey: "00000000-0000-4000-8000-000000000002",
        messages: [{ role: "user", parts: [{ type: "text", text: "and again" }] }],
      }),
    );

    const turn1 = dispatchedOf(first.mocks.dispatch);
    const turn2 = dispatchedOf(second.mocks.dispatch);
    // The instructions lane is what providers cache as the request prefix: it
    // must not vary a byte while the conversation grows.
    expect(turn2.system).toBe(turn1.system);
    expect(turn2.historySeed).not.toBe(turn1.historySeed);
  });

  /** @scenario A brand-new conversation carries no memory */
  it("does not go looking for a history a fresh conversation cannot have", async () => {
    const { deps, mocks } = makeDeps({
      conversations: {
        ensureConversation: vi.fn(async () => ({ id: "conv-1", isNew: true })),
        tryFindByIdVisible: vi.fn(async () => null),
        tryGetPendingHandoff: vi.fn(async () => null),
        tryGetRunToken: vi.fn(async () => "run-token"),
        acceptTurn: vi.fn(async () => undefined),
        finalizeTurn: vi.fn(async () => undefined),
      } as unknown as LangyTurnServiceDeps["conversations"],
    });

    await LangyTurnService.create(deps).startConversationTurn(input());

    expect(mocks.findAllByConversation).not.toHaveBeenCalled();
    const { prompt, historySeed } = dispatchedOf(mocks.dispatch);
    expect(historySeed).toBeUndefined();
    // Nothing to prepend, nothing to set apart: the bare ask stays bare.
    expect(prompt).toBe("hi");
  });

  /** @scenario A conversation whose record cannot be read still answers */
  it("still runs the turn when the durable record cannot be read", async () => {
    const { deps, mocks } = makeDeps();
    mocks.findAllByConversation.mockRejectedValue(new Error("projection down"));

    const result = await LangyTurnService.create(deps).startConversationTurn(input());

    expect(result).toMatchObject({ conversationId: "conv-1" });
    expect(mocks.dispatch).toHaveBeenCalledOnce();
    expect(dispatchedOf(mocks.dispatch).historySeed).toBeUndefined();
  });
});
