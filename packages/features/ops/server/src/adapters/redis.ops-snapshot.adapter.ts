import { OpsSnapshotService } from "@langwatch/ops-contract";
import { OpsSnapshotRedisPort } from "../ports/ops-snapshot-redis.port.ts";
import { RedisOpsSnapshotRepository } from "../repositories/redis/redis.ops-snapshot.repository.ts";
import { DefaultOpsSnapshotService } from "../services/ops-snapshot-reader.service.ts";

export interface RedisOpsSnapshotAdapterOptions {
  redis: OpsSnapshotRedisPort;
}

export class RedisOpsSnapshotAdapter {
  static create({ redis }: RedisOpsSnapshotAdapterOptions): OpsSnapshotService {
    const repository = RedisOpsSnapshotRepository.create(redis);
    return DefaultOpsSnapshotService.create(repository);
  }
}
