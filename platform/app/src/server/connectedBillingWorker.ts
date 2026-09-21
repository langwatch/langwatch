/**
 * The daily billing tick of a connected self-hosted customer (ADR-141,
 * section 7).
 *
 * Three things run on it, in order and independently: the quarterly seat
 * true-up, which invoices the seats a customer added in a quarter that has
 * closed; the monthly statement, which mails the billing contact what the
 * month cost; and the pending renewals, whose credit waits for the last usage
 * invoice of the old term to be finalized.
 *
 * It runs on LangWatch Cloud only, because every row it reads and every
 * invoice it creates belongs there. A self-hosted install starts nothing.
 */

import { createConnectedBillingService } from "@ee/billing/connected/connectedBilling.prisma";
import { createConnectedMonthlyStatementService } from "@ee/billing/connected/monthlyStatement.prisma";
import { createConnectedSeatTrueUpService } from "@ee/billing/connected/seatTrueUp.prisma";
import { createLogger } from "@langwatch/observability";
import { env } from "~/env.mjs";
import type { PrismaClient } from "~/generated/prisma/client";
import { prisma as defaultPrisma } from "~/server/db";
import {
  captureException,
  toError,
  withScope,
} from "~/utils/posthogErrorCapture";

const logger = createLogger("langwatch:workers:connectedBillingWorker");

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The first tick waits for the process to finish coming up. Nothing here is
 * urgent to the minute: a quarter that closed overnight is invoiced within the
 * day either way.
 */
const FIRST_TICK_DELAY_MS = 5 * 60 * 1000;

export interface ConnectedBillingWorkerHandle {
  stop(): void;
}

/** One run of each of the three jobs, as the tick drives them. */
export interface ConnectedBillingJobs {
  runSeatTrueUp(): Promise<unknown>;
  runMonthlyStatements(): Promise<unknown>;
  /** The organizations holding a renewal whose credit has not been created. */
  listPendingRenewalOrganizationIds(): Promise<string[]>;
  completeRenewalIfDue(input: { organizationId: string }): Promise<unknown>;
}

/**
 * The jobs, bound to the database and the payment provider.
 *
 * Built inside the tick rather than at boot: the payment provider client
 * refuses to exist without its key, and a worker should not fail to start over
 * a job it would have skipped anyway.
 */
export function createConnectedBillingJobs(
  prisma: PrismaClient,
): ConnectedBillingJobs {
  const billing = createConnectedBillingService(prisma);
  return {
    runSeatTrueUp: () => createConnectedSeatTrueUpService(prisma).run(),
    runMonthlyStatements: () =>
      createConnectedMonthlyStatementService(prisma).run(),
    listPendingRenewalOrganizationIds: () =>
      listPendingRenewalOrganizationIds(prisma),
    completeRenewalIfDue: (input) => billing.completeRenewalIfDue(input),
  };
}

/**
 * Organizations whose billing account holds a pending renewal.
 *
 * Read one organization at a time from the customers an operator marked as
 * self-hosted, because the tenancy guard refuses a bare read of every billing
 * account and is right to.
 */
async function listPendingRenewalOrganizationIds(
  prisma: PrismaClient,
): Promise<string[]> {
  const organizations = await prisma.organization.findMany({
    where: { selfHostedCustomer: true },
    select: { id: true },
  });

  const pending: string[] = [];
  for (const organization of organizations) {
    const account = await prisma.connectedBillingAccount.findUnique({
      where: { organizationId: organization.id },
      select: { pendingRenewal: true },
    });
    if (account?.pendingRenewal) pending.push(organization.id);
  }
  return pending;
}

/** One tick. A job that throws is reported and does not stop the next. */
export async function runConnectedBillingTick(
  jobs: ConnectedBillingJobs,
): Promise<void> {
  await runJob("seatTrueUp", () => jobs.runSeatTrueUp());
  await runJob("monthlyStatements", () => jobs.runMonthlyStatements());
  await runJob("renewals", async () => {
    for (const organizationId of await jobs.listPendingRenewalOrganizationIds()) {
      await jobs.completeRenewalIfDue({ organizationId });
    }
  });
}

async function runJob(
  name: string,
  run: () => Promise<unknown>,
): Promise<void> {
  try {
    await run();
  } catch (error) {
    logger.error({ job: name, error }, "connected billing job failed");
    await withScope(async (scope) => {
      scope.setTag?.("worker", "connectedBilling");
      scope.setTag?.("job", name);
      captureException(toError(error));
    });
  }
}

export interface ConnectedBillingWorkerDependencies {
  /** Injected by suites; the process client otherwise. */
  readonly prisma?: PrismaClient;
  /** Injected by suites; built from the database and the provider otherwise. */
  readonly jobs?: ConnectedBillingJobs;
}

/**
 * Long-running scheduler that runs the billing tick once a day. Returns
 * undefined, having started nothing, on a deployment that is not LangWatch
 * Cloud.
 */
export function startConnectedBillingWorker(
  dependencies: ConnectedBillingWorkerDependencies = {},
): ConnectedBillingWorkerHandle | undefined {
  if (!env.IS_SAAS) {
    logger.info("not LangWatch Cloud, skipping the connected billing worker");
    return undefined;
  }

  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const tick = async () => {
    if (stopped) return;
    try {
      const jobs =
        dependencies.jobs ??
        createConnectedBillingJobs(dependencies.prisma ?? defaultPrisma);
      await runConnectedBillingTick(jobs);
    } catch (error) {
      logger.warn(
        { error },
        "connected billing tick failed (will retry on the next interval)",
      );
    }
    if (!stopped) {
      timer = setTimeout(() => void tick(), DAY_MS);
    }
  };

  timer = setTimeout(() => void tick(), FIRST_TICK_DELAY_MS);
  logger.info(
    { firstTickDelayMs: FIRST_TICK_DELAY_MS },
    "connected billing worker started",
  );

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      logger.info("connected billing worker stopped");
    },
  };
}
