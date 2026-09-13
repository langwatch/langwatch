/**
 * A stop that lands before the worker is running the turn.
 *
 * The turn is admitted, and its handoff stashed, seconds before any worker
 * touches it: the fast-path dispatch is fire-and-forget and the process outbox
 * re-drives the same handoff on its own schedule. So the stop has to reach the
 * WORK as well as the record, or the answer the user stopped is generated
 * anyway. Driven against a real Redis, because the marker and the handoff it
 * guards are two keys with one lifetime.
 *
 * @see specs/langy/langy-stop-and-resume.feature
 */
import type { Redis } from "ioredis";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { LangyTurnServiceDeps } from "~/server/app-layer/langy/langy-turn.service";
import { LangyTurnService } from "~/server/app-layer/langy/langy-turn.service";
import {
  type LangyHandoffRedis,
  type LangyTurnHandoff,
  LangyTurnHandoffStore,
} from "~/server/app-layer/langy/streaming/langyTurnHandoff";
import { startTestContainers } from "~/server/event-sourcing/__tests__/integration/testContainers";
import { createLangyEffectPorts } from "~/server/event-sourcing/pipelines/langy-conversation-processing/process-manager/langyEffectPorts";

let redis: Redis;
let handoffStore: LangyTurnHandoffStore;

const IDS = {
  projectId: "project-stop",
  conversationId: "conv-stop",
  turnId: "turn-stop",
  userId: "user-stop",
};

function handoff(): LangyTurnHandoff {
  return {
    projectId: IDS.projectId,
    conversationId: IDS.conversationId,
    turnId: IDS.turnId,
    actorUserId: IDS.userId,
    prompt: "Explain this trace",
    system: "System prompt",
    credentials: {
      langwatchApiKey: "sk-lw-turn",
      langwatchApiKeyId: "key-1",
      llmVirtualKey: "vk-1",
      langwatchEndpoint: "https://langwatch.test",
      gatewayBaseUrl: "https://gateway.test/v1",
      organizationId: "organization-1",
    },
    runToken: "run-token",
    permitReserved: false,
  };
}

function makeStopDeps() {
  const finalizeTurn = vi.fn(async (_args: Record<string, unknown>) => ({
    messageId: "a1",
  }));
  const cancel = vi.fn(async () => {});
  return {
    finalizeTurn,
    cancel,
    deps: {
      conversations: {
        finalizeTurn,
        findByIdVisible: vi.fn(async () => ({
          isOwn: true,
          currentTurnId: IDS.turnId,
        })),
      } as unknown as LangyTurnServiceDeps["conversations"],
      credentials: {} as unknown as LangyTurnServiceDeps["credentials"],
      resolveModel: vi.fn(),
      // No worker is running the turn yet, which is the whole point: the cancel
      // reaches the manager and finds nothing to abort.
      worker: { cancel } as unknown as LangyTurnServiceDeps["worker"],
      tokenBuffer: {
        readTail: vi.fn(async () => ({ reads: [], lastId: "0" })),
        markEnd: vi.fn(async () => {}),
      } as unknown as LangyTurnServiceDeps["tokenBuffer"],
      reservePermit: vi.fn(),
      releasePermit: vi.fn(),
      perDayPrCap: 0,
      mintSessionKey: vi.fn(),
      revokeSessionKey: vi.fn(),
      admission: {} as unknown as LangyTurnServiceDeps["admission"],
      accessStore: {
        isTurnActor: vi.fn(async () => true),
      } as unknown as LangyTurnServiceDeps["accessStore"],
      handoffStore,
      messages: null,
    } as LangyTurnServiceDeps,
  };
}

function makeDispatchPorts() {
  const dispatch = vi.fn(async () => "accepted" as const);
  const ports = createLangyEffectPorts({
    handoffStore,
    worker: { dispatch },
    mintSessionKey: vi.fn(),
    revokeSessionKey: vi.fn(),
    titleGenerator: vi.fn(),
    saveTitle: vi.fn(),
    failTurn: { failTurn: vi.fn() },
    markError: vi.fn(),
  } as unknown as Parameters<typeof createLangyEffectPorts>[0]);
  return { ports, dispatch };
}

beforeAll(async () => {
  ({ redisConnection: redis } = await startTestContainers());
  handoffStore = new LangyTurnHandoffStore(
    redis as unknown as LangyHandoffRedis,
  );
});

afterEach(async () => {
  const keys = await redis.keys("langy:*stop*");
  if (keys.length > 0) await redis.del(...keys);
  vi.clearAllMocks();
});

describe("given a turn was admitted but its worker is not running it yet", () => {
  describe("when the user stops that turn", () => {
    /** @scenario A stop before the worker starts still stops the turn */
    it("settles the turn as stopped and keeps a later dispatch from starting the work", async () => {
      await handoffStore.stash(handoff());
      const { deps, finalizeTurn } = makeStopDeps();

      await LangyTurnService.create(deps).stopTurn({
        projectId: IDS.projectId,
        conversationId: IDS.conversationId,
        turnId: IDS.turnId,
        userId: IDS.userId,
      });

      expect(finalizeTurn).toHaveBeenCalledTimes(1);
      expect(finalizeTurn.mock.calls[0]![0]).toMatchObject({
        outcome: "stopped",
        turnId: IDS.turnId,
      });

      // The outbox still holds the dispatch intent for this turn — the fast
      // path's own dispatch may never have been accepted — and it runs after
      // the stop.
      const { ports, dispatch } = makeDispatchPorts();
      await ports.workerDispatch.dispatchTurn({
        projectId: IDS.projectId,
        conversationId: IDS.conversationId,
        turnId: IDS.turnId,
        resumeFromTurnId: null,
      });

      expect(dispatch).not.toHaveBeenCalled();
    });
  });
});

describe("given a turn nobody stopped", () => {
  describe("when the outbox dispatches it", () => {
    it("starts the work as usual", async () => {
      await handoffStore.stash(handoff());
      const { ports, dispatch } = makeDispatchPorts();

      await ports.workerDispatch.dispatchTurn({
        projectId: IDS.projectId,
        conversationId: IDS.conversationId,
        turnId: IDS.turnId,
        resumeFromTurnId: null,
      });

      expect(dispatch).toHaveBeenCalledTimes(1);
    });
  });
});
