/**
 * The UI-action dispatch/claim/complete protocol, against fakes
 * (specs/langy/langy-ui-actions.feature). The Redis fake models exactly the
 * primitives the service leans on — SET NX, BLPOP with a timeout, key
 * deletion — because the at-most-once and away-detection guarantees live in
 * how those primitives are sequenced.
 */
import { describe, expect, it } from "vitest";
import {
  LangyUiActionService,
  type UiActionBlockingRedis,
  type UiActionRedis,
  uiActionKeys,
} from "../ui-action.service";

interface FakeStore {
  kv: Map<string, string>;
  lists: Map<string, string[]>;
}

/**
 * `blpopBehavior` scripts the blocking waits in order: each call takes the
 * next behavior. "wait-empty" models the timeout with nothing arriving;
 * a function models something landing mid-wait (it runs, then the list is
 * read).
 */
function makeRedis(blpopBehavior: Array<"wait-empty" | (() => void)> = []): {
  redis: UiActionRedis;
  store: FakeStore;
  blpopCalls: number[];
} {
  const store: FakeStore = { kv: new Map(), lists: new Map() };
  const blpopCalls: number[] = [];
  let behaviorIndex = 0;

  const blocking: UiActionBlockingRedis = {
    blpop: async (key, timeoutSeconds) => {
      blpopCalls.push(timeoutSeconds);
      const behavior = blpopBehavior[behaviorIndex++] ?? "wait-empty";
      if (typeof behavior === "function") behavior();
      const list = store.lists.get(key) ?? [];
      const value = list.pop();
      return value === undefined ? null : [key, value];
    },
    disconnect: () => undefined,
  };

  const redis: UiActionRedis = {
    set: async (key, value, _mode, _ttl, nx) => {
      if (nx === "NX" && store.kv.has(key)) return null;
      store.kv.set(key, value);
      return "OK";
    },
    get: async (key) => store.kv.get(key) ?? null,
    del: async (...keys) => {
      let count = 0;
      for (const key of keys) if (store.kv.delete(key)) count++;
      return count;
    },
    lpush: async (key, value) => {
      const list = store.lists.get(key) ?? [];
      list.push(value);
      store.lists.set(key, list);
      return list.length;
    },
    expire: async () => 1,
    duplicate: () => blocking,
  };
  return { redis, store, blpopCalls };
}

function makeService({
  redis,
  currentTurnId = "turn-1",
  conversationExists = true,
  appended = [],
  presenceSessions,
  backendRunner,
}: {
  redis: UiActionRedis;
  currentTurnId?: string | null;
  conversationExists?: boolean;
  appended?: Array<{ actionId: string; kind: string; payload: unknown }>;
  presenceSessions?: unknown[];
  backendRunner?: (args: {
    kind: string;
    payload: unknown;
    experimentSlug?: string;
  }) => Promise<unknown>;
}) {
  return new LangyUiActionService({
    redis,
    conversations: {
      findByIdVisible: async () =>
        conversationExists ? { currentTurnId } : null,
    },
    buffer: {
      appendUiAction: async ({ actionId, kind, payload }) => {
        appended.push({ actionId, kind, payload });
      },
    },
    ...(presenceSessions
      ? {
          presence: {
            isEnabledForProject: async () => true,
            getByProject: async () => presenceSessions,
          },
        }
      : {}),
    ...(backendRunner
      ? {
          backendRunner: ({ kind, payload, experimentSlug }) =>
            backendRunner({ kind, payload, experimentSlug }),
        }
      : {}),
  });
}

const DISPATCH = {
  projectId: "project-1",
  userId: "user-1",
  conversationId: "conv-1",
  notFound: () => new Error("not-found"),
};

describe("LangyUiActionService", () => {
  describe("when the conversation is not visible to the key's user", () => {
    /** @scenario A conversation id from another project is refused without confirming it exists */
    it("refuses with the caller's not-found error", async () => {
      const { redis } = makeRedis();
      const service = makeService({ redis, conversationExists: false });

      await expect(
        service.dispatch({
          ...DISPATCH,
          kind: "workbench.duplicateTarget",
          payload: { targetId: "t1" },
        }),
      ).rejects.toThrow("not-found");
    });
  });

  describe("when the conversation has no turn in flight", () => {
    /** @scenario An action outside a running turn is refused */
    it("refuses with langy_ui_turn_inactive", async () => {
      const { redis } = makeRedis();
      const service = makeService({ redis, currentTurnId: null });

      await expect(
        service.dispatch({
          ...DISPATCH,
          kind: "workbench.duplicateTarget",
          payload: { targetId: "t1" },
        }),
      ).rejects.toMatchObject({ code: "langy_ui_turn_inactive" });
    });
  });

  describe("when the kind names no page action", () => {
    /** @scenario An unknown action kind is refused with langy_ui_action_unknown */
    it("refuses with langy_ui_action_unknown", async () => {
      const { redis } = makeRedis();
      const service = makeService({ redis });

      await expect(
        service.dispatch({
          ...DISPATCH,
          kind: "workbench.dropTables",
          payload: {},
        }),
      ).rejects.toMatchObject({ code: "langy_ui_action_unknown" });
    });
  });

  describe("when the payload fails the action's schema", () => {
    /** @scenario A payload failing its schema is refused with langy_ui_payload_invalid */
    it("refuses before anything reaches the stream", async () => {
      const { redis } = makeRedis();
      const appended: Array<{ actionId: string }> = [];
      const service = makeService({ redis, appended });

      await expect(
        service.dispatch({
          ...DISPATCH,
          kind: "workbench.duplicateTarget",
          payload: { targetId: 42 },
        }),
      ).rejects.toMatchObject({ code: "langy_ui_payload_invalid" });
      expect(appended).toHaveLength(0);
    });
  });

  describe("when the page claims and completes inside the window", () => {
    /** @scenario Agent invokes a workbench action and the attached browser applies it live */
    /** @scenario The action's result returns to the agent within the same CLI call */
    it("returns the page's result as a browser execution", async () => {
      const appended: Array<{ actionId: string; kind: string }> = [];
      // The first blocking wait finds the result: the fake claims + completes
      // mid-wait, the way a fast page beats the claim window.
      const { redis, store } = makeRedis([
        () => {
          const actionId = appended[0]!.actionId;
          store.lists.set(uiActionKeys.result(actionId), [
            JSON.stringify({ ok: true, result: { targetId: "t2" } }),
          ]);
        },
      ]);
      const service = makeService({ redis, appended });

      const outcome = await service.dispatch({
        ...DISPATCH,
        kind: "workbench.duplicateTarget",
        payload: { targetId: "t1" },
      });

      expect(outcome).toMatchObject({
        status: "done",
        executedVia: "browser",
        kind: "workbench.duplicateTarget",
        result: { targetId: "t2" },
      });
      expect(appended[0]).toMatchObject({ kind: "workbench.duplicateTarget" });
    });
  });

  describe("when nothing claims the action inside the claim window", () => {
    /** @scenario An unclaimed action deletes its pending record before answering */
    it("deletes the pending record and refuses with langy_ui_no_browser", async () => {
      const appended: Array<{ actionId: string }> = [];
      const { redis, store } = makeRedis(["wait-empty"]);
      const service = makeService({ redis, appended });

      await expect(
        service.dispatch({
          ...DISPATCH,
          kind: "workbench.duplicateTarget",
          payload: { targetId: "t1" },
        }),
      ).rejects.toMatchObject({ code: "langy_ui_no_browser" });

      const actionId = appended[0]!.actionId;
      expect(store.kv.has(uiActionKeys.pending(actionId))).toBe(false);
      // A zombie tab claiming after the dispatch answered finds nothing.
      const late = await service.claim({
        projectId: "project-1",
        userId: "user-1",
        conversationId: "conv-1",
        turnId: "turn-1",
        actionId,
      });
      expect(late).toEqual({ claimed: false });
    });
  });

  describe("when the page claims and then goes silent", () => {
    /** @scenario A claimed action that never completes times out without re-dispatching */
    it("refuses with langy_ui_timeout after the execute budget", async () => {
      const appended: Array<{ actionId: string }> = [];
      const { redis, store, blpopCalls } = makeRedis([
        // Claim window lapses with no result, but a claim key appeared.
        () => {
          const actionId = appended[0]!.actionId;
          store.kv.set(uiActionKeys.claim(actionId), "user-1");
        },
        "wait-empty",
      ]);
      const service = makeService({ redis, appended });

      await expect(
        service.dispatch({
          ...DISPATCH,
          kind: "workbench.duplicateTarget",
          payload: { targetId: "t1" },
        }),
      ).rejects.toMatchObject({ code: "langy_ui_timeout" });
      // Two waits: the claim window, then the remaining execute budget.
      expect(blpopCalls).toHaveLength(2);
    });
  });

  describe("when the page reports a failure", () => {
    /** @scenario A browser handler failure reaches the agent as langy_ui_handler_failed and the user as a toast */
    it("carries the page's error code to the agent", async () => {
      const appended: Array<{ actionId: string }> = [];
      const { redis, store } = makeRedis([
        () => {
          const actionId = appended[0]!.actionId;
          store.lists.set(uiActionKeys.result(actionId), [
            JSON.stringify({ ok: false, errorCode: "target_not_found" }),
          ]);
        },
      ]);
      const service = makeService({ redis, appended });

      await expect(
        service.dispatch({
          ...DISPATCH,
          kind: "workbench.duplicateTarget",
          payload: { targetId: "t1" },
        }),
      ).rejects.toMatchObject({
        code: "langy_ui_handler_failed",
        meta: expect.objectContaining({ errorCode: "target_not_found" }),
      });
    });
  });

  describe("the claim", () => {
    async function dispatchPending(service: LangyUiActionService) {
      // Dispatch with an immediate no-browser refusal is not usable to seed a
      // pending record (it deletes it), so seed one the way dispatch does.
      return service;
    }

    /** @scenario With two tabs open, only the claiming tab executes */
    it("lets exactly one caller claim", async () => {
      const { redis, store } = makeRedis();
      const service = makeService({ redis });
      await dispatchPending(service);
      store.kv.set(
        uiActionKeys.pending("a1"),
        JSON.stringify({
          projectId: "project-1",
          conversationId: "conv-1",
          turnId: "turn-1",
          kind: "workbench.duplicateTarget",
        }),
      );

      const args = {
        projectId: "project-1",
        conversationId: "conv-1",
        turnId: "turn-1",
        actionId: "a1",
      };
      expect(await service.claim({ ...args, userId: "user-1" })).toEqual({
        claimed: true,
      });
      expect(await service.claim({ ...args, userId: "user-2" })).toEqual({
        claimed: false,
      });
    });

    /** @scenario A claim naming a different turn than the dispatch pinned is refused */
    it("refuses a claim whose pin does not match", async () => {
      const { redis, store } = makeRedis();
      const service = makeService({ redis });
      store.kv.set(
        uiActionKeys.pending("a1"),
        JSON.stringify({
          projectId: "project-1",
          conversationId: "conv-1",
          turnId: "turn-1",
          kind: "workbench.duplicateTarget",
        }),
      );

      for (const mismatch of [
        { projectId: "project-2", conversationId: "conv-1", turnId: "turn-1" },
        { projectId: "project-1", conversationId: "conv-2", turnId: "turn-1" },
        { projectId: "project-1", conversationId: "conv-1", turnId: "turn-2" },
      ]) {
        expect(
          await service.claim({
            ...mismatch,
            userId: "user-1",
            actionId: "a1",
          }),
        ).toEqual({ claimed: false });
      }
    });
  });

  describe("the completion", () => {
    function seed(store: FakeStore) {
      store.kv.set(
        uiActionKeys.pending("a1"),
        JSON.stringify({
          projectId: "project-1",
          conversationId: "conv-1",
          turnId: "turn-1",
          kind: "workbench.duplicateTarget",
        }),
      );
      store.kv.set(uiActionKeys.claim("a1"), "user-1");
    }

    /** @scenario Only the claiming user's session may complete an action */
    it("drops a completion from anyone but the claimant", async () => {
      const { redis, store } = makeRedis();
      seed(store);
      const service = makeService({ redis });

      const fromOther = await service.complete({
        projectId: "project-1",
        userId: "user-2",
        conversationId: "conv-1",
        turnId: "turn-1",
        actionId: "a1",
        completion: { ok: true },
      });
      expect(fromOther).toEqual({ accepted: false });
      expect(store.lists.get(uiActionKeys.result("a1"))).toBeUndefined();

      const fromClaimant = await service.complete({
        projectId: "project-1",
        userId: "user-1",
        conversationId: "conv-1",
        turnId: "turn-1",
        actionId: "a1",
        completion: { ok: true, result: { targetId: "t2" } },
      });
      expect(fromClaimant).toEqual({ accepted: true });
      expect(store.lists.get(uiActionKeys.result("a1"))).toHaveLength(1);
      expect(store.kv.has(uiActionKeys.pending("a1"))).toBe(false);
    });

    it("replaces an oversized result with a typed failure", async () => {
      const { redis, store } = makeRedis();
      seed(store);
      const service = makeService({ redis });

      await service.complete({
        projectId: "project-1",
        userId: "user-1",
        conversationId: "conv-1",
        turnId: "turn-1",
        actionId: "a1",
        completion: { ok: true, result: "x".repeat(70 * 1024) },
      });
      const [raw] = store.lists.get(uiActionKeys.result("a1"))!;
      expect(JSON.parse(raw!)).toEqual({
        ok: false,
        errorCode: "result_too_large",
      });
    });
  });

  describe("when no live tab is present for the project", () => {
    /** @scenario With no browser attached the same verb executes on the backend transparently */
    it("skips the publish entirely and answers from the backend", async () => {
      const { redis } = makeRedis();
      const appended: Array<{
        actionId: string;
        kind: string;
        payload: unknown;
      }> = [];
      const runnerCalls: Array<{ kind: string; experimentSlug?: string }> = [];
      const service = makeService({
        redis,
        appended,
        presenceSessions: [],
        backendRunner: async ({ kind, experimentSlug }) => {
          runnerCalls.push({ kind, experimentSlug });
          return { targetId: "t2" };
        },
      });

      const outcome = await service.dispatch({
        ...DISPATCH,
        kind: "workbench.duplicateTarget",
        payload: { targetId: "t1" },
        experimentSlug: "my-exp",
      });

      expect(outcome.executedVia).toBe("backend");
      expect(outcome.result).toEqual({ targetId: "t2" });
      expect(appended).toHaveLength(0);
      expect(runnerCalls).toEqual([
        { kind: "workbench.duplicateTarget", experimentSlug: "my-exp" },
      ]);
    });
  });

  describe("when the published action goes unclaimed", () => {
    /** @scenario An unclaimed action falls back to the backend after the claim window */
    it("deletes the pending record first, then executes on the backend", async () => {
      const { redis, store } = makeRedis(["wait-empty"]);
      const appended: Array<{
        actionId: string;
        kind: string;
        payload: unknown;
      }> = [];
      let pendingAtRunnerTime: boolean | null = null;
      const service = makeService({
        redis,
        appended,
        // A live tab exists, so the publish happens; it just never claims.
        presenceSessions: [{}],
        backendRunner: async () => {
          pendingAtRunnerTime = [...store.kv.keys()].some((key) =>
            key.startsWith("langy:ui:pending:"),
          );
          return { ok: true };
        },
      });

      const outcome = await service.dispatch({
        ...DISPATCH,
        kind: "workbench.duplicateTarget",
        payload: { targetId: "t1" },
        experimentSlug: "my-exp",
      });

      expect(outcome.executedVia).toBe("backend");
      expect(appended).toHaveLength(1);
      // A zombie tab claiming late must find nothing to claim.
      expect(pendingAtRunnerTime).toBe(false);
    });
  });

  describe("when a page claimed the action and went silent", () => {
    /** @scenario A claimed but silent action times out and never double-executes */
    it("times out without running the backend", async () => {
      // The first scripted wait plants the claim before it lapses: the page
      // took the action and never completed. The second wait times out too.
      let plantClaim: (() => void) | undefined;
      const { redis, store } = makeRedis([() => plantClaim?.(), "wait-empty"]);
      plantClaim = () => {
        const pendingKey = [...store.kv.keys()].find((key) =>
          key.startsWith("langy:ui:pending:"),
        );
        if (!pendingKey) return;
        const actionId = pendingKey.replace("langy:ui:pending:", "");
        store.kv.set(uiActionKeys.claim(actionId), "user-1");
      };
      let runnerCalled = false;
      const service = makeService({
        redis,
        presenceSessions: [{}],
        backendRunner: async () => {
          runnerCalled = true;
          return {};
        },
      });

      await expect(
        service.dispatch({
          ...DISPATCH,
          kind: "workbench.duplicateTarget",
          payload: { targetId: "t1" },
        }),
      ).rejects.toThrow(/did not finish inside the action's time budget/);
      expect(runnerCalled).toBe(false);
    });
  });
});
