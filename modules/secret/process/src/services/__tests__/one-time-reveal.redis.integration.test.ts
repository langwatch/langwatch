/**
 * The one-time reveal over a real Redis: the secret rests sealed until it is
 * read, and the id serves it once. Runs when LANGWATCH_TEST_REDIS_URL (or
 * REDIS_URL) names a Redis; skipped otherwise.
 * @see specs/langy/langy-secret-snippet.feature
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { RedisConnectionService, type RedisConnection } from "@langwatch/redis-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RedisOneTimeRevealRepository } from "../../repositories/redis/redis.one-time-reveal.repository.ts";
import type { SecretCipher } from "../../repositories/secret.repositories.ts";
import { OneTimeRevealService } from "../one-time-reveal.service.ts";

const redisUrl = process.env.LANGWATCH_TEST_REDIS_URL ?? process.env.REDIS_URL;
const ORGANIZATION = "org_reveal_integration";
const SECRET = "secret-content-marker";

/** A real AES-256-GCM cipher under a throwaway key, so the resting value is genuinely opaque. */
function aesCipher(): SecretCipher {
  const key = randomBytes(32);
  return {
    encrypt(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
    },
    decrypt(value) {
      const raw = Buffer.from(value, "base64");
      const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
      decipher.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    },
  };
}

describe.skipIf(!redisUrl)("given a virtual key secret stashed under a reveal id", () => {
  let redis: RedisConnection;
  let service: OneTimeRevealService;

  beforeAll(() => {
    redis = new RedisConnectionService().connect({
      url: redisUrl,
      clusterEndpoints: undefined,
      dbIndex: undefined,
    })!;
    service = OneTimeRevealService.create({
      store: RedisOneTimeRevealRepository.create({
        redis,
        cipher: aesCipher(),
      }),
    });
  });

  afterAll(async () => {
    await redis?.quit();
  });

  /** @scenario "The first reveal returns the secret and the second refuses" */
  it("serves the secret sealed once, then refuses the same id", async () => {
    const { revealId } = await service.stash({
      organizationId: ORGANIZATION,
      kind: "virtual_key",
      keyId: "vk_1",
      preview: "sk-…4f2a",
      secret: SECRET,
    });

    const resting = await redis.get(`secret_reveal:${ORGANIZATION}:${revealId}`);
    expect(resting).not.toBeNull();
    expect(resting).not.toContain(SECRET);

    await expect(service.reveal({ organizationId: ORGANIZATION, revealId })).resolves.toMatchObject(
      { secret: SECRET },
    );
    expect(await redis.get(`secret_reveal:${ORGANIZATION}:${revealId}`)).toBeNull();

    await expect(service.reveal({ organizationId: ORGANIZATION, revealId })).rejects.toMatchObject({
      code: "secret_already_revealed",
    });
  });
});
