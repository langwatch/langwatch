/**
 * The private ClickHouse targets still catching up their migrations, shared through Redis because
 * it is short term and every instance reads it (Alex, 2026-10-11, T7-F18). The worker's catch-up
 * pass writes it; every serving process reads it every few seconds. Spec: in-app-upgrade.feature.
 */
import {
  RedisConfigService,
  RedisConnectionService,
  RedisShutdownService,
} from "@langwatch/redis-client";
import { z } from "zod";

import type { ImageUpgradeInputs } from "../runner/image-upgrade.ts";

/** One key: the organisation ids of the private targets the ledger records behind. */
export const TARGETS_CATCHING_UP_KEY = "upgrade:clickhouse-targets-catching-up";

/** Twice the catch-up pass's longest wait, so a key outlives the pass that refreshes it. */
export const TARGETS_CATCHING_UP_TTL_MS = 10 * 60_000;

/** How often a serving process reads the list again. */
export const TARGETS_CATCHING_UP_READ_EVERY_MS = 5_000;

/** A Redis that does not answer within this reads as unreachable; the process falls back. */
const REDIS_ANSWER_MS = 1_000;

const organizationIdsSchema = z.array(z.string());

/** Where the list lives; Redis in a deployment, a double in tests. */
export type TargetsCatchingUpStore = Readonly<{
  write: (input: { organizationIds: readonly string[] }) => Promise<void>;
  read: () => Promise<readonly string[]>;
  close: () => Promise<void>;
}>;

/** The process's Redis, opened on first use as the read-hint publisher opens it; null if none. */
export function redisTargetsCatchingUp({
  url,
  environment,
}: {
  url: string | undefined;
  environment: ImageUpgradeInputs["environment"];
}): TargetsCatchingUpStore | null {
  const environmentOf = {
    url,
    clusterEndpoints: environment.REDIS_CLUSTER_ENDPOINTS,
    dbIndex: environment.REDIS_DB_INDEX,
    skip: environment.SKIP_REDIS === "true",
  };
  if (!new RedisConfigService().resolve(environmentOf).configured) return null;
  let connection: ReturnType<RedisConnectionService["connect"]> | undefined;
  const open = () => {
    connection ??= new RedisConnectionService().connect(environmentOf);
    if (!connection) throw new Error("Redis is not configured for this process");
    return connection;
  };
  return {
    write: async ({ organizationIds }) => {
      const redis = open();
      if (organizationIds.length === 0) {
        await answeredWithin(redis.del(TARGETS_CATCHING_UP_KEY));
        return;
      }
      const value = JSON.stringify(organizationIds);
      await answeredWithin(
        redis.set(TARGETS_CATCHING_UP_KEY, value, "PX", TARGETS_CATCHING_UP_TTL_MS),
      );
    },
    read: async () => {
      const held = await answeredWithin(open().get(TARGETS_CATCHING_UP_KEY));
      return held === null ? [] : organizationIdsSchema.parse(JSON.parse(held));
    },
    close: async () => {
      if (connection) await RedisShutdownService.create().shutdown(connection);
    },
  };
}

/** Reads the list now and every `everyMs`; a failed read hands on an empty list (as before). */
export function watchTargetsCatchingUp({
  store,
  onChange,
  everyMs = TARGETS_CATCHING_UP_READ_EVERY_MS,
}: {
  store: Pick<TargetsCatchingUpStore, "read">;
  onChange: (organizationIds: readonly string[]) => void;
  everyMs?: number;
}): Readonly<{ stop: () => Promise<void> }> {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reading: Promise<void> = Promise.resolve();
  const once = async () => {
    const organizationIds = await store.read().catch(() => []);
    if (stopped) return;
    onChange(organizationIds);
    timer = setTimeout(() => {
      reading = once();
    }, everyMs);
    timer.unref?.();
  };
  reading = once();
  return {
    stop: async () => {
      stopped = true;
      clearTimeout(timer);
      await reading;
      onChange([]);
    },
  };
}

function answeredWithin<T>(command: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Redis did not answer in time")), REDIS_ANSWER_MS);
    timer.unref?.();
  });
  return Promise.race([command, late]).finally(() => clearTimeout(timer));
}
