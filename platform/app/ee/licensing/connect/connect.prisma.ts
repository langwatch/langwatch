/**
 * Prisma and app bindings for the hosted services of a self-hosted license
 * (ADR-141), and the one place that builds them.
 */

import { SYSTEM_ACTORS } from "@langwatch/actor";
import type { PrismaClient } from "~/generated/prisma/client";
import { getApp } from "~/server/app-layer/app";
import { getInstantEvalClassifier } from "~/server/app-layer/instant-evals/classifier";
import { createInstantEvalSpendRecorderForHostedCalls } from "~/server/app-layer/instant-evals/spend";
import { GatewayBudgetService } from "~/server/gateway/budget.service";
import { resolveApplicableBudgets } from "~/server/gateway/budgetResolution.service";
import { PrismaIssuedLicenseRepository } from "../registry/issuedLicense.prisma";
import { sharedConnectSpendBuffer } from "./connectSpend.runtime";
import { ConnectSpendBuffer } from "./connectSpendBuffer";
import {
  type ContractBudget,
  ContractBudgetService,
  type ContractBudgetStore,
} from "./contractBudget.service";
import {
  type HostedBudgetUsage,
  type HostedCaller,
  HostedServicesService,
  type HostedUsageReader,
} from "./hostedServices.service";

/** Addresses the contract budget within its organization. */
export const CONTRACT_BUDGET_EXTERNAL_ID = "connect-contract";
const CAP_SET_BY = "connect_cap_set_by";
const CENTS = 100;

function budgetService(prisma: PrismaClient): GatewayBudgetService {
  return GatewayBudgetService.create(prisma, getApp().gateway.budgets);
}

export class PrismaContractBudgetStore implements ContractBudgetStore {
  constructor(private readonly prisma: PrismaClient) {}

  async find(organizationId: string): Promise<ContractBudget | null> {
    const row = await this.prisma.gatewayBudget.findFirst({
      where: {
        organizationId,
        externalId: CONTRACT_BUDGET_EXTERNAL_ID,
        archivedAt: null,
      },
      select: { id: true, limitUsd: true, metadata: true },
    });
    if (!row) return null;
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      limitUsdCents: Math.round(row.limitUsd.toNumber() * CENTS),
      capSetByCustomer: metadata[CAP_SET_BY] === "customer",
    };
  }

  async create({
    organizationId,
    limitUsdCents,
    operatorId,
  }: {
    organizationId: string;
    limitUsdCents: number;
    operatorId: string;
  }): Promise<void> {
    await budgetService(this.prisma).create({
      organizationId,
      scope: { kind: "ORGANIZATION", organizationId },
      name: "Hosted services contract",
      description:
        "Hard stop for LangWatch-hosted services used by this customer's self-hosted installs.",
      // The period is the contract term, moved by renewal and not by a calendar.
      window: "MANUAL",
      limitUsd: (limitUsdCents / CENTS).toFixed(2),
      onBreach: "BLOCK",
      externalId: CONTRACT_BUDGET_EXTERNAL_ID,
      metadata: { [CAP_SET_BY]: "langwatch" },
      // The managed key that reaches it is created on the install's first call.
      allowUnreachable: true,
      actorUserId: operatorId,
    });
  }

  async setLimit({
    organizationId,
    id,
    limitUsdCents,
    capSetByCustomer,
    actorId,
  }: {
    organizationId: string;
    id: string;
    limitUsdCents: number;
    capSetByCustomer: boolean;
    actorId: string;
  }): Promise<void> {
    await budgetService(this.prisma).update({
      id,
      organizationId,
      limitUsd: (limitUsdCents / CENTS).toFixed(2),
      metadata: { [CAP_SET_BY]: capSetByCustomer ? "customer" : "langwatch" },
      actorUserId: actorId,
    });
  }
}

/** The budgets that apply to the calling key, with live spend when readable. */
export class PrismaHostedUsageReader implements HostedUsageReader {
  constructor(private readonly prisma: PrismaClient) {}

  async read(caller: HostedCaller) {
    const project = caller.projectId
      ? await this.prisma.project.findUnique({
          where: { id: caller.projectId },
          select: { teamId: true },
        })
      : null;
    const key = await this.prisma.virtualKey.findFirst({
      where: { id: caller.virtualKeyId, organizationId: caller.organizationId },
      select: { principalUserId: true },
    });
    const applicable = await resolveApplicableBudgets({
      client: this.prisma,
      target: {
        organizationId: caller.organizationId,
        virtualKeyId: caller.virtualKeyId,
        teamId: project?.teamId ?? null,
        projectId: caller.projectId,
        principalUserId: key?.principalUserId ?? null,
      },
    });
    const applicableIds = new Set(applicable.map(({ budget }) => budget.id));

    const { budgets, spendAvailable, readAt } = await budgetService(
      this.prisma,
    ).listWithHealth(caller.organizationId);

    return {
      spendAvailable,
      readAt,
      budgets: budgets
        .filter((budget) => applicableIds.has(budget.id))
        .map(
          (budget): HostedBudgetUsage => ({
            id: budget.id,
            scope: budget.scopeType.toLowerCase(),
            window: budget.window.toLowerCase(),
            limitUsd: budget.limitUsd.toNumber(),
            spentUsd: spendAvailable ? budget.spentUsd.toNumber() : null,
            onBreach: budget.onBreach === "BLOCK" ? "block" : "warn",
            periodStartedAt: budget.currentPeriodStartedAt,
            isContract: budget.externalId === CONTRACT_BUDGET_EXTERNAL_ID,
          }),
        ),
    };
  }
}

export function createContractBudgetService(
  prisma: PrismaClient,
): ContractBudgetService {
  const licenses = new PrismaIssuedLicenseRepository(prisma);
  return new ContractBudgetService({
    store: new PrismaContractBudgetStore(prisma),
    licensesOf: (organizationId) =>
      licenses.findAllByOrganization(organizationId),
    systemActorId: SYSTEM_ACTORS.connectLicense,
  });
}

function connectSpendBuffer(): ConnectSpendBuffer {
  return sharedConnectSpendBuffer(
    () =>
      new ConnectSpendBuffer({
        recorder: createInstantEvalSpendRecorderForHostedCalls(),
      }),
  );
}

export function createHostedServicesService(
  prisma: PrismaClient,
): HostedServicesService {
  const licenses = new PrismaIssuedLicenseRepository(prisma);
  return new HostedServicesService({
    licenseOfKey: (virtualKeyId) => licenses.findByVirtualKeyId(virtualKeyId),
    classifier: getInstantEvalClassifier,
    spend: connectSpendBuffer(),
    usage: new PrismaHostedUsageReader(prisma),
    contractBudgets: createContractBudgetService(prisma),
  });
}
