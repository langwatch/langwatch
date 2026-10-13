import type { InstantEvalRepositories } from "../instant-eval.repositories.ts";
import { ClickHouseInstantEvalJudgmentsRepository } from "./clickhouse.instant-eval-judgments.repository.ts";
import { ClickHouseInstantEvalRunRepository } from "./clickhouse.instant-eval-run.repository.ts";
import type {
  InstantEvalClickHouseMember,
  InstantEvalClickHouseResolver,
} from "./clickhouse.instant-eval-session.store.ts";
import { ClickHouseInstantEvalSession } from "./clickhouse.instant-eval-session.store.ts";

/**
 * Both tables over the process's one routing ClickHouse client, resolved per
 * tenant so every statement names its tenant first.
 */
export class ClickHouseInstantEvalRepositories {
  static create(
    members: Readonly<{ clickhouse: InstantEvalClickHouseMember }>,
  ): Pick<InstantEvalRepositories, "runs" | "judgments"> {
    const resolveClient: InstantEvalClickHouseResolver = (tenantId) =>
      Promise.resolve(new ClickHouseInstantEvalSession(members.clickhouse, tenantId));

    return {
      runs: ClickHouseInstantEvalRunRepository.create({ resolveClient }),
      judgments: ClickHouseInstantEvalJudgmentsRepository.create({ resolveClient }),
    };
  }
}
