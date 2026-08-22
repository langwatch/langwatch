/**
 * The dispatch → claim → complete round trip against a REAL Redis, so the
 * BLPOP wait, the SET NX claim race and the pending-record lifecycle stay
 * exact (specs/langy/langy-ui-actions.feature). The unit tests drive the same
 * protocol through an in-memory fake; a blocking-read or NX subtlety would
 * slip past them silently.
 */
import type { Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../../event-sourcing/__tests__/integration/testContainers";
import {
  LangyUiActionService,
  type UiActionRedis,
  uiActionKeys,
} from "../ui-action.service";

let redis: Redis;

const IDS = {
  projectId: "project-ui",
  userId: "user-ui",
  conversationId: "conv-ui",
  turnId: "turn-ui",
};

function makeService(appended: Array<{ actionId: string }>) {
  return new LangyUiActionService({
    redis: redis as unknown as UiActionRedis,
    conversations: {
      findByIdVisible: async () => ({ currentTurnId: IDS.turnId }),
    },
    buffer: {
      appendUiAction: async ({ actionId }) => {
        appended.push({ actionId });
      },
    },
  });
}

async function clearUiKeys() {
  const keys = await redis.keys("langy:ui:*");
  if (keys.length > 0) await redis.del(...keys);
}

beforeAll(async () => {
  ({ redisConnection: redis } = await startTestContainers());
  await clearUiKeys();
});

afterEach(async () => {
  await clearUiKeys();
});

afterAll(async () => {
  await stopTestContainers();
});

describe("LangyUiActionService against real Redis", () => {
  /** @scenario Agent invokes a workbench action and the attached browser applies it live */
  it("returns the completion a concurrent claim and complete deliver", async () => {
    const appended: Array<{ actionId: string }> = [];
    const service = makeService(appended);

    const dispatch = service.dispatch({
      ...IDS,
      kind: "workbench.duplicateTarget",
      payload: { targetId: "t1" },
      notFound: () => new Error("not-found"),
    });

    // The page's side, racing the dispatch's blocking wait.
    const page = (async () => {
      while (appended.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const actionId = appended[0]!.actionId;
      const claim = await service.claim({ ...IDS, actionId });
      expect(claim).toEqual({ claimed: true });
      const complete = await service.complete({
        ...IDS,
        actionId,
        completion: { ok: true, result: { targetId: "t2" } },
      });
      expect(complete).toEqual({ accepted: true });
    })();

    const [outcome] = await Promise.all([dispatch, page]);
    expect(outcome).toMatchObject({
      status: "done",
      executedVia: "browser",
      result: { targetId: "t2" },
    });
    // The round trip consumed its keys: nothing pending, nothing left to read.
    const actionId = appended[0]!.actionId;
    expect(await redis.get(uiActionKeys.pending(actionId))).toBeNull();
  });

  /** @scenario With two tabs open, only the claiming tab executes */
  it("lets exactly one of two concurrent claims through", async () => {
    const appended: Array<{ actionId: string }> = [];
    const service = makeService(appended);

    const dispatch = service
      .dispatch({
        ...IDS,
        kind: "workbench.duplicateTarget",
        payload: { targetId: "t1" },
        notFound: () => new Error("not-found"),
      })
      .catch((error: unknown) => error);

    while (appended.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const actionId = appended[0]!.actionId;

    const [first, second] = await Promise.all([
      service.claim({ ...IDS, actionId }),
      service.claim({ ...IDS, userId: "user-tab-2", actionId }),
    ]);
    expect([first.claimed, second.claimed].sort()).toEqual([false, true]);

    const claimant = first.claimed ? IDS.userId : "user-tab-2";
    await service.complete({
      ...IDS,
      userId: claimant,
      actionId,
      completion: { ok: true },
    });
    const outcome = await dispatch;
    expect(outcome).toMatchObject({ executedVia: "browser" });
  });
});
