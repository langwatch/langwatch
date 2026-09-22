/**
 * @vitest-environment node
 *
 * The one-time reveal against real Redis: the secret goes in sealed, comes
 * out once, and the second read is told apart from a read of nothing.
 *
 * Spec: specs/langy/langy-secret-snippet.feature
 * Requires: Redis (LANGWATCH_TEST_REDIS_URL)
 */
import { HandledError } from "@langwatch/handled-error";
import {
  type RedisConnection,
  RedisConnectionService,
} from "@langwatch/redis-client";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("~/server/app-layer/app", () => ({ tryGetApp: () => null }));
vi.mock("~/utils/encryption", () => ({
  encrypt: (text: string) => `sealed:${Buffer.from(text).toString("base64")}`,
  decrypt: (text: string) =>
    Buffer.from(text.replace(/^sealed:/, ""), "base64").toString(),
}));

import { OneTimeRevealService } from "../oneTimeReveal.service";

const ORG = `org-reveal-${Date.now()}`;
const SECRET = "vk-lw-01HZX9NABCDEFGHJKMNPQRSTVW";

let connection: RedisConnection | null = null;
const revealIds: string[] = [];

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HandledError) return error.code;
    throw error;
  }
  throw new Error("expected a handled error");
}

beforeAll(() => {
  connection = new RedisConnectionService().connect({
    url: process.env.REDIS_URL,
    clusterEndpoints: process.env.REDIS_CLUSTER_ENDPOINTS,
    dbIndex: process.env.REDIS_DB_INDEX,
  });
  if (!connection) {
    throw new Error(
      "This suite needs Redis. Set LANGWATCH_TEST_REDIS_URL in platform/app/.env.",
    );
  }
});

afterAll(() => {
  connection?.disconnect();
});

afterEach(async () => {
  for (const revealId of revealIds) {
    await connection?.del(`secret_reveal:${ORG}:${revealId}`);
    await connection?.del(`secret_revealed:${ORG}:${revealId}`);
  }
  revealIds.length = 0;
});

describe("Feature: a one-time reveal on Redis", () => {
  describe("given a stashed virtual key secret", () => {
    describe("when it is read twice", () => {
      /** @scenario "The first reveal returns the secret and the second refuses" */
      it("serves the secret once, sealed at rest, and refuses the second read as already revealed", async () => {
        const service = new OneTimeRevealService(connection);
        const { revealId } = await service.stash({
          organizationId: ORG,
          kind: "virtual_key",
          keyId: "vk_1",
          preview: "vk-lw-01HZX9N",
          secret: SECRET,
        });
        revealIds.push(revealId);

        const atRest = await connection!.get(
          `secret_reveal:${ORG}:${revealId}`,
        );
        expect(atRest).not.toBeNull();
        expect(atRest).not.toContain(SECRET);
        const ttl = await connection!.pttl(`secret_reveal:${ORG}:${revealId}`);
        expect(ttl).toBeGreaterThan(23 * 60 * 60 * 1000);

        const first = await service.reveal({ organizationId: ORG, revealId });
        expect(first.secret).toBe(SECRET);
        expect(first.preview).toBe("vk-lw-01HZX9N");
        expect(
          await connection!.get(`secret_reveal:${ORG}:${revealId}`),
        ).toBeNull();

        expect(
          await codeOf(service.reveal({ organizationId: ORG, revealId })),
        ).toBe("secret_already_revealed");
      });
    });
  });

  describe("given a reveal id nothing was stashed under", () => {
    describe("when it is read", () => {
      /** @scenario "A reveal id that never existed or has expired is refused" */
      it("refuses the read as expired", async () => {
        const service = new OneTimeRevealService(connection);
        expect(
          await codeOf(
            service.reveal({ organizationId: ORG, revealId: "rvl_never" }),
          ),
        ).toBe("secret_reveal_expired");
      });
    });
  });
});
