import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import { nowInstant } from "@langwatch/time";

import type { EvaluationRetentionFloor } from "../app/evaluation.members.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The oldest instant a run read looks at: now minus the platform default
 * retention, the same number the run fold stamps its rows with.
 */
export class EvaluationRetentionFloorService implements EvaluationRetentionFloor {
  private constructor(
    private readonly retention: Pick<DataRetentionApi, "getPlatformDefaultRetentionDays">,
  ) {}

  static create(
    retention: Pick<DataRetentionApi, "getPlatformDefaultRetentionDays">,
  ): EvaluationRetentionFloorService {
    return new EvaluationRetentionFloorService(retention);
  }

  async getFloorMs(): Promise<number> {
    return (
      nowInstant().epochMilliseconds - this.retention.getPlatformDefaultRetentionDays() * DAY_MS
    );
  }
}
