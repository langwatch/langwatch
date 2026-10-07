import type { InstantEvalJudgeProjectPlacement } from "../repositories/instant-eval-judge-project.repository.ts";
import type {
  InstantEvalJudgeSpendRow,
  InstantEvalJudgeSpendWrite,
} from "../repositories/instant-eval-judge-spend.repository.ts";
import type { InstantEvalJudgeUsageBilling } from "../repositories/instant-eval-judge-usage-billing.repository.ts";
import type { InstantEvalJudgeRepositories } from "../repositories/instant-eval-judge.repositories.ts";

type InstantEvalJudgeFactRepositories = Pick<
  InstantEvalJudgeRepositories,
  "projects" | "usageBilling" | "spend"
>;

/**
 * Folds the facts the judge checks before each call into its own tables, and reads them back
 * (ADR-174 decisions 13, 17). Every fold is safe to repeat: a peer event is delivered at least
 * once and never deduplicated for a subscriber.
 */
export class InstantEvalJudgeFactsService {
  private constructor(private readonly repositories: InstantEvalJudgeFactRepositories) {}

  static create({
    repositories,
  }: {
    repositories: InstantEvalJudgeFactRepositories;
  }): InstantEvalJudgeFactsService {
    return new InstantEvalJudgeFactsService(repositories);
  }

  /** Project's `lw.project.created`: the project's organization, kept as first written. */
  projectCreated({
    projectId,
    organizationId,
    occurredAt,
  }: {
    projectId: string;
    organizationId: string;
    occurredAt: number;
  }): Promise<void> {
    return this.repositories.projects.upsert({
      projectId,
      organizationId,
      createdAtMs: occurredAt,
    });
  }

  /** Billing's usage-billing fact, real or catch-up; the newest stamp wins. */
  usageBillingChanged({
    organizationId,
    usageBilled,
    occurredAt,
    fromCatchUp,
  }: {
    organizationId: string;
    usageBilled: boolean;
    occurredAt: number;
    fromCatchUp: boolean;
  }): Promise<void> {
    return this.repositories.usageBilling.upsert({
      organizationId,
      usageBilled,
      occurredAtMs: occurredAt,
      fromCatchUp,
    });
  }

  /** One row per request; a request already recorded keeps its first row. */
  recordSpend(row: InstantEvalJudgeSpendRow): Promise<InstantEvalJudgeSpendWrite> {
    return this.repositories.spend.create(row);
  }

  getProjectPlacement({
    projectId,
  }: {
    projectId: string;
  }): Promise<InstantEvalJudgeProjectPlacement> {
    return this.repositories.projects.getPlacement({ projectId });
  }

  getUsageBilling({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<InstantEvalJudgeUsageBilling> {
    return this.repositories.usageBilling.getUsageBilling({ organizationId });
  }

  getSpendTotal({ organizationId }: { organizationId: string }): Promise<{ spendNanoUsd: bigint }> {
    return this.repositories.spend.getTotal({ organizationId });
  }
}
