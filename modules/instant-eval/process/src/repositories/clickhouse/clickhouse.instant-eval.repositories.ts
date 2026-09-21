import type { InstantEvalClickHouseResolver } from "../../app/instant-eval.members.ts";
import type { InstantEvalRepositories } from "../instant-eval.repositories.ts";
import { ClickHouseInstantEvalJudgmentsRepository } from "./clickhouse.instant-eval-judgments.repository.ts";
import { ClickHouseInstantEvalRunRepository } from "./clickhouse.instant-eval-run.repository.ts";

/** Both stores over one tenant-resolved ClickHouse connection. */
export class ClickHouseInstantEvalRepositories implements InstantEvalRepositories {
  readonly runs: ClickHouseInstantEvalRunRepository;
  readonly judgments: ClickHouseInstantEvalJudgmentsRepository;

  private constructor(resolveClient: InstantEvalClickHouseResolver) {
    this.runs = ClickHouseInstantEvalRunRepository.create({ resolveClient });
    this.judgments = ClickHouseInstantEvalJudgmentsRepository.create({ resolveClient });
  }

  static create({
    resolveClient,
  }: {
    resolveClient: InstantEvalClickHouseResolver;
  }): ClickHouseInstantEvalRepositories {
    return new ClickHouseInstantEvalRepositories(resolveClient);
  }
}
