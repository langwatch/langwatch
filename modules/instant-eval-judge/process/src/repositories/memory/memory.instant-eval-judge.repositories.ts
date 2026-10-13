import {
  type InstantEvalJudgeUsageBillingFact,
  usageBillingFactWins,
} from "../../rules/instant-eval-judge-usage-billing.rules.ts";
import {
  type InstantEvalJudgeProjectPlacement,
  InstantEvalJudgeProjectRepository,
} from "../instant-eval-judge-placement.repository.ts";
import {
  InstantEvalJudgeSpendRepository,
  type InstantEvalJudgeSpendRow,
  type InstantEvalJudgeSpendWrite,
} from "../instant-eval-judge-spend.repository.ts";
import {
  type InstantEvalJudgeUsageBilling,
  InstantEvalJudgeUsageBillingRepository,
} from "../instant-eval-judge-usage-billing.repository.ts";
import type { InstantEvalJudgeRepositories } from "../instant-eval-judge.repositories.ts";
import { MemoryInstantEvalRateLimitRepository } from "./memory.instant-eval-rate-limit.repository.ts";

type MemoryInstantEvalJudgeProjectRow = { organizationId: string };

/** In-memory twin of the project placement project's and organization's tables hold. */
export class MemoryInstantEvalJudgeProjectRepository extends InstantEvalJudgeProjectRepository {
  private constructor(private readonly rows: Map<string, MemoryInstantEvalJudgeProjectRow>) {
    super();
  }

  /** A test hands in the map, standing in for the projects their owners hold. */
  static create({
    rows = new Map<string, MemoryInstantEvalJudgeProjectRow>(),
  }: {
    rows?: Map<string, MemoryInstantEvalJudgeProjectRow>;
  } = {}): MemoryInstantEvalJudgeProjectRepository {
    return new MemoryInstantEvalJudgeProjectRepository(rows);
  }

  async getPlacement({
    projectId,
  }: {
    projectId: string;
  }): Promise<InstantEvalJudgeProjectPlacement> {
    const row = this.rows.get(projectId);
    return row ? { outcome: "known", organizationId: row.organizationId } : { outcome: "unknown" };
  }
}

/** In-memory twin of the judge's usage-billing copy; it keeps a fact by the shared rule. */
export class MemoryInstantEvalJudgeUsageBillingRepository extends InstantEvalJudgeUsageBillingRepository {
  private constructor(private readonly rows: Map<string, InstantEvalJudgeUsageBillingFact>) {
    super();
  }

  /** A test may hand in the map, to see how many rows the folds left. */
  static create({
    rows = new Map<string, InstantEvalJudgeUsageBillingFact>(),
  }: {
    rows?: Map<string, InstantEvalJudgeUsageBillingFact>;
  } = {}): MemoryInstantEvalJudgeUsageBillingRepository {
    return new MemoryInstantEvalJudgeUsageBillingRepository(rows);
  }

  async getUsageBilling({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<InstantEvalJudgeUsageBilling> {
    const fact = this.rows.get(organizationId);
    return fact ? { outcome: "folded", fact } : { outcome: "never_folded" };
  }

  async upsert({
    organizationId,
    ...incoming
  }: { organizationId: string } & InstantEvalJudgeUsageBillingFact): Promise<void> {
    const held = this.rows.get(organizationId) ?? null;
    if (usageBillingFactWins({ held, incoming })) this.rows.set(organizationId, incoming);
  }
}

/** In-memory twin of the judge's spend rows, keyed by organization and request. */
export class MemoryInstantEvalJudgeSpendRepository extends InstantEvalJudgeSpendRepository {
  private constructor(private readonly rows: Map<string, InstantEvalJudgeSpendRow>) {
    super();
  }

  /** A test may hand in the map, to see how many rows the copies left. */
  static create({
    rows = new Map<string, InstantEvalJudgeSpendRow>(),
  }: {
    rows?: Map<string, InstantEvalJudgeSpendRow>;
  } = {}): MemoryInstantEvalJudgeSpendRepository {
    return new MemoryInstantEvalJudgeSpendRepository(rows);
  }

  async create(row: InstantEvalJudgeSpendRow): Promise<InstantEvalJudgeSpendWrite> {
    const key = `${row.organizationId}\u0000${row.requestId}`;
    if (this.rows.has(key)) return { outcome: "already_recorded" };
    this.rows.set(key, row);
    return { outcome: "recorded" };
  }

  async getTotal({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ spendNanoUsd: bigint }> {
    let spendNanoUsd = 0n;
    for (const row of this.rows.values()) {
      if (row.organizationId === organizationId) spendNanoUsd += row.spendNanoUsd;
    }
    return { spendNanoUsd };
  }
}

export class MemoryInstantEvalJudgeRepositories {
  static readonly requires = [] as const;

  static create(): InstantEvalJudgeRepositories {
    return {
      projects: MemoryInstantEvalJudgeProjectRepository.create(),
      usageBilling: MemoryInstantEvalJudgeUsageBillingRepository.create(),
      spend: MemoryInstantEvalJudgeSpendRepository.create(),
      rateLimits: MemoryInstantEvalRateLimitRepository.create(),
    };
  }
}
