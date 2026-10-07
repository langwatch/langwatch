import type { OpsReplayRuntime } from "../../app/ops.app.ts";
import { ReplayRuntimeRepository } from "../replay-runtime.repository.ts";

/** A memory process holds no event log in ClickHouse and no Redis, so a replay run refuses. */
export class MemoryReplayRuntimeRepository extends ReplayRuntimeRepository {
  static create(): MemoryReplayRuntimeRepository {
    return new MemoryReplayRuntimeRepository();
  }

  create(): OpsReplayRuntime {
    throw new Error("Replay requires the live stores: a memory process holds no event log.");
  }
}
