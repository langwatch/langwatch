/**
 * Stop before worker runs turn: must reach WORK and record or answer generates
 * anyway. Uses real Redis (marker+handoff two keys one lifetime). See
 * specs/langy/langy-stop-and-resume.feature.
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { Redis } from "ioredis";
import IORedis from "ioredis";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { LangyWorker } from "../app/langy.members.ts";
import type { LangyTurnHandoff } from "../repositories/langy-live-turn.repository.ts";
import { RedisLangyEffectRepository } from "../repositories/redis/redis.langy-effect.repository.ts";
import { LangyTurnHandoffRedisRepository } from "../repositories/redis/redis.langy-turn-handoff.repository.ts";
import { LangyTurnService } from "../services/langy-turn.service.ts";
import { conversationDetail, langyTurnDeps } from "./support/langy-turn-deps.ts";
import { testRedisUrl } from "./support/test-redis-url.ts";

/** Native Redis, the way every other datastore suite in this repo asks for one. */
const REDIS_URL = testRedisUrl();

let redis: Redis;
let handoffStore: LangyTurnHandoffRedisRepository;

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
      ...langyTurnDeps({
        conversations: {
          finalizeTurn,
          findByIdVisible: vi.fn(async () =>
            conversationDetail({ isOwn: true, currentTurnId: IDS.turnId }),
          ),
        },
        credentials: {},
        // No worker is running the turn yet, which is the whole point: the cancel
        // reaches the manager and finds nothing to abort.
        worker: { cancel },
        tokenBuffer: {
          readTail: vi.fn(async () => ({ reads: [], lastId: "0" })),
          markEnd: vi.fn(async () => ({ backstopped: false })),
        },
        admission: {},
        accessStore: { isTurnActor: vi.fn(async () => true) },
        messages: null,
      }),
      handoffStore,
    },
  };
}

function makeDispatchPorts() {
  const dispatch = vi.fn(async () => "accepted" as const);
  const ports = RedisLangyEffectRepository.create({
    handoffStore,
    worker: createApiFixture<LangyWorker>({ dispatch }, "worker"),
    mintSessionKey: vi.fn(),
    revokeSessionKey: vi.fn(),
    titleGenerator: vi.fn(),
    saveTitle: vi.fn(),
    failTurn: { failTurn: vi.fn() },
    markError: vi.fn(),
  });
  return { ports, dispatch };
}

beforeAll(() => {
  redis = new IORedis(REDIS_URL!);
  handoffStore = LangyTurnHandoffRedisRepository.create({
    redis,
  });
});

afterEach(async () => {
  const keys = await redis.keys("langy:*stop*");
  if (keys.length > 0) await redis.del(...keys);
  vi.clearAllMocks();
});

describe.skipIf(!REDIS_URL)(
  "given a turn was admitted but its worker is not running it yet",
  () => {
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
  },
);

describe.skipIf(!REDIS_URL)("given a turn nobody stopped", () => {
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
