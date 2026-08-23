import type { Redis } from "ioredis";

import {
  defineGroupQueue,
  GroupQueueConsumer,
  GroupQueueProducer,
} from "@langwatch/group-queue";
import {
  BLOB_SWEEP_INTERVAL_MS,
  CachedLuaScript,
  GroupStagingScripts,
  readEnvelopeDescriptor,
  RedisJobBlobStore,
  TieredBlobStore,
} from "@langwatch/group-queue/operational";

// @ts-expect-error Internal processors are not a package export.
import type {} from "@langwatch/group-queue/src/groupQueue";
// @ts-expect-error Operational Redis machinery is not a root export.
import { GroupStagingScripts as RootGroupStagingScripts } from "@langwatch/group-queue";

void [
  BLOB_SWEEP_INTERVAL_MS,
  CachedLuaScript,
  GroupStagingScripts,
  readEnvelopeDescriptor,
  RedisJobBlobStore,
  TieredBlobStore,
  RootGroupStagingScripts,
];

interface Work extends Record<string, unknown> {
  id: string;
  group: string;
}

declare const redis: Redis;

const work = defineGroupQueue<Work, "work">({
  name: "work",
  payload: { parse: (value) => value as Work },
  groupBy: (value) => value.group,
  identify: (value) => value.id,
});

const producer = new GroupQueueProducer(work, { redis });
const consumer = new GroupQueueConsumer(work, { redis });
const running = consumer.handle(async () => undefined);

producer.send({ id: "job", group: "tenant/group" });

// @ts-expect-error Producer capabilities cannot register handlers.
producer.handle(async () => undefined);
// @ts-expect-error Consumer authoring capabilities cannot stage work.
consumer.send({ id: "job", group: "tenant/group" });
// @ts-expect-error Running consumers cannot stage work either.
running.send({ id: "job", group: "tenant/group" });
