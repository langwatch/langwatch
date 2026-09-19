/**
 * The spend recorder and the free budget, wired from the environment.
 *
 * Both resolve the pipelines they need at call time rather than at
 * construction, because they are built while the application container is
 * still being assembled and the event-sourcing pipelines register after it.
 * A deployment with no spend pipeline (ClickHouse off) logs the spend instead
 * of losing it, and a deployment that is not SaaS has no free budget at all:
 * its classifier key is the operator's own, so there is nothing of ours to
 * cap.
 *
 * @see ./spend-pipeline-instant-eval-spend.recorder.ts
 * @see ../../usage/instant-eval-free-budget.service.ts
 */

import { env } from "~/env.mjs";
import { getApp, tryGetApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import { BILLING_REPORTING_PIPELINE_NAME } from "~/server/event-sourcing/pipelines/billing-reporting/pipeline";
import { GATEWAY_SPEND_PIPELINE_NAME } from "~/server/event-sourcing/pipelines/gateway-spend-processing/schemas/constants";
import { getBillingMonth } from "../../../../../ee/billing/services/billableEventsQuery";
import { createInstantEvalBudgetReservations } from "../../usage/instant-eval-budget-reservations";
import {
  type InstantEvalFreeBudget,
  InstantEvalFreeBudgetService,
  UNBOUNDED_INSTANT_EVAL_BUDGET,
} from "../../usage/instant-eval-free-budget.service";
import {
  type InstantEvalSpendRecord,
  type InstantEvalSpendRecorder,
  LoggingInstantEvalSpendRecorder,
} from "../instant-eval-spend.recorder";
import {
  type InstantEvalSpendAttribution,
  SpendPipelineInstantEvalSpendRecorder,
} from "./spend-pipeline-instant-eval-spend.recorder";

/** A registered pipeline's command surface, or null when it is not there. */
function pipelineCommands(
  name: string,
): Record<string, { send: (payload: unknown) => Promise<unknown> }> | null {
  const eventSourcing = tryGetApp()?.eventSourcing;
  if (!eventSourcing) return null;
  try {
    return eventSourcing.getPipeline(name).commands as Record<
      string,
      { send: (payload: unknown) => Promise<unknown> }
    >;
  } catch {
    return null;
  }
}

/** The project's organization and team, read once per record. */
async function attributionFor(
  projectId: string,
): Promise<InstantEvalSpendAttribution | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { teamId: true, team: { select: { organizationId: true } } },
  });
  if (!project?.team) return null;
  return {
    organizationId: project.team.organizationId,
    teamId: project.teamId,
  };
}

/**
 * The spend recorder: the spend spine when it is registered, a log line when
 * it is not. Decided per record, because the pipeline registers after this
 * module is first imported.
 */
export function createInstantEvalSpendRecorderFromEnv(): InstantEvalSpendRecorder {
  const logging = new LoggingInstantEvalSpendRecorder();
  const spine = new SpendPipelineInstantEvalSpendRecorder({
    attribution: attributionFor,
    dispatch: async (data) => {
      const commands = pipelineCommands(GATEWAY_SPEND_PIPELINE_NAME);
      if (!commands?.confirmSpend) {
        throw new Error("gateway spend pipeline is not registered");
      }
      return await commands.confirmSpend.send(data);
    },
    reportBilling: async ({ organizationId, occurredAt }) => {
      const commands = pipelineCommands(BILLING_REPORTING_PIPELINE_NAME);
      if (!commands?.reportUsageForMonth) return;
      await commands.reportUsageForMonth.send({
        organizationId,
        billingMonth: getBillingMonth(occurredAt),
        tenantId: organizationId,
        occurredAt: Date.now(),
      });
    },
  });
  return {
    recordSpend: async (record: InstantEvalSpendRecord) => {
      const recorder = pipelineCommands(GATEWAY_SPEND_PIPELINE_NAME)
        ? spine
        : logging;
      await recorder.recordSpend(record);
    },
  };
}

/** The organization a project belongs to, or null when it has none. */
async function organizationOf(projectId: string): Promise<string | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { team: { select: { organizationId: true } } },
  });
  return project?.team?.organizationId ?? null;
}

/** Every project of the organization, archived ones included: the ledger's
 *  tenant is the project the spend happened in, whatever became of it. */
async function projectsOf(organizationId: string): Promise<string[]> {
  const projects = await prisma.project.findMany({
    where: { team: { organizationId } },
    select: { id: true },
  });
  return projects.map((project) => project.id);
}

/** The free budget on SaaS, and no budget anywhere else. */
export function createInstantEvalFreeBudgetFromEnv(): InstantEvalFreeBudget {
  if (!env.IS_SAAS) return UNBOUNDED_INSTANT_EVAL_BUDGET;
  return new InstantEvalFreeBudgetService({
    organizationOf,
    projectsOf,
    isFreePlan: async (organizationId) =>
      (await getApp().planProvider.getActivePlan({ organizationId })).free,
    sumSpendNanoUsd: async ({ tenantIds, requestType }) => {
      const spendEvents = getApp().gateway.spendEvents;
      // No ledger means nothing was ever recorded on it, so nothing was spent.
      if (!spendEvents) return 0;
      return await spendEvents.sumCostNanoUsdByRequestType({
        tenantIds,
        requestType,
      });
    },
    reservations: createInstantEvalBudgetReservations({
      redis: tryGetApp()?.redis,
    }),
  });
}
