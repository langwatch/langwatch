import type {
  InstantEvalClickHouseMember,
  InstantEvalClickHouseResolver,
} from "../../app/instant-eval.members.ts";
import type { InstantEvalRepositories } from "../instant-eval.repositories.ts";
import { ClickHouseInstantEvalJudgmentsRepository } from "./clickhouse.instant-eval-judgments.repository.ts";
import { ClickHouseInstantEvalRunRepository } from "./clickhouse.instant-eval-run.repository.ts";
import { ClickHouseInstantEvalSession } from "./clickhouse.instant-eval-session.store.ts";

/**
 * The live tier: both stores over the process's one routing ClickHouse
 * member, resolved per tenant so every statement names its tenant first.
 */
export class ClickHouseInstantEvalRepositories {
  static readonly requires = ["clickhouse"] as const;

  static create(
    members: Readonly<{ clickhouse: InstantEvalClickHouseMember }>,
  ): InstantEvalRepositories {
    const resolveClient: InstantEvalClickHouseResolver = (tenantId) =>
      Promise.resolve(new ClickHouseInstantEvalSession(members.clickhouse, tenantId));

    return {
      runs: ClickHouseInstantEvalRunRepository.create({ resolveClient }),
      judgments: ClickHouseInstantEvalJudgmentsRepository.create({ resolveClient }),
    };
  }
}
