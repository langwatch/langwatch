import { skipTenantCheck } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { findLedgerStepRecords, type LedgerStepRecord } from "@langwatch/upgrade/reader";

import { MANAGED_PROMPT_VERSION_REPLAY_STEP_ID } from "../../rules/trace-widget-columns.rules.ts";
import { ManagedPromptVersionLedgerRepository } from "../managed-prompt-version-ledger.repository.ts";

// The upgrade ledger describes the installation, not a tenant.
const LEDGER_TENANCY = `${skipTenantCheck({ SKIP_TENANT_CHECK: true }).sql}\n`;

/** Reads the managed prompt version replay step's ledger row over this process's Postgres. */
export class PrismaManagedPromptVersionLedgerRepository extends ManagedPromptVersionLedgerRepository {
  private constructor(private readonly prisma: Pick<PrismaClient, "$queryRawUnsafe">) {
    super();
  }

  static create({
    prisma,
  }: {
    prisma: Pick<PrismaClient, "$queryRawUnsafe">;
  }): PrismaManagedPromptVersionLedgerRepository {
    return new PrismaManagedPromptVersionLedgerRepository(prisma);
  }

  findReplayStep(): Promise<LedgerStepRecord[]> {
    const postgres = {
      query: async <Row extends object>(text: string, values: unknown[] = []) => ({
        rows: await this.prisma.$queryRawUnsafe<Row[]>(`${LEDGER_TENANCY}${text}`, ...values),
      }),
    };
    return findLedgerStepRecords({ postgres, id: MANAGED_PROMPT_VERSION_REPLAY_STEP_ID });
  }
}
