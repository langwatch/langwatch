/**
 * What an organization has spent and what its plan allows, composed as its own
 * feature.
 *
 * `costs.*` is this process's own row read — one organization's spend, rolled
 * up per project and narrowed to the projects the caller can reach — and
 * `limits.*` is the deployment's billing store, which arrives as a port because
 * no core package owns it.
 *
 * Both used to be composed inside the observability half. They are here
 * together because they are the same question asked twice: what this
 * organization has used, and against what allowance.
 */
import type { CostTrpcPorts, LimitsTrpcPorts } from "@langwatch/entitlement-server";
import { HandledError } from "@langwatch/handled-error";
import type { Logger } from "@langwatch/observability";
import type { Cost, PrismaClient, Project } from "@langwatch/prisma-client/generated";

import type { ApiTrpcFeatureMount } from "../../api.application";
import type { ApiTrpcInfrastructure } from "../../app-trpc/app-trpc.infrastructure";
import { createCostTrpcRouter, createLimitsTrpcRouter } from "./entitlement-trpc.mount";

/**
 * The usage reading and the approaching-limit mail, over the deployment's
 * billing store.
 *
 * Absent, both refuse rather than reporting zero: a usage panel showing zero of
 * an allowance is a wrong answer, not a smaller one.
 */
export abstract class ApiUsageStatsPort {
  abstract ports(): LimitsTrpcPorts;
}

/** Reports the one capability this feature can be composed without. */
export abstract class ApiSpendAbsenceReport {
  abstract absent(capability: "usage"): void;
}

/** Writes the absence to the process log, once, at composition time. */
export class LoggedApiSpendAbsence extends ApiSpendAbsenceReport {
  static create(logger: Pick<Logger, "warn">): LoggedApiSpendAbsence {
    return new LoggedApiSpendAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  absent(capability: "usage"): void {
    this.logger.warn(
      { capability },
      "API process composed no usage reader: the subscription screen's usage panel and the approaching-limit mail both refuse rather than reporting zero of an allowance.",
    );
  }
}

/** One project's spend, as the billing screen groups it. */
export type ApiProjectSpendRollup = Readonly<{
  project: Project;
  costs: ReadonlyArray<
    Readonly<{
      projectId: string;
      costType: Cost["costType"];
      currency: string;
      referenceId?: string;
      costName?: string;
      _sum: { amount: number | null };
      _count: { id: number };
    }>
  >;
}>;

/** The two namespaces, built over the composed readings. */
export type ComposedSpendFeature = Readonly<{
  routers(mount: ApiTrpcFeatureMount): {
    costs: ReturnType<typeof createCostTrpcRouter>;
    limits: ReturnType<typeof createLimitsTrpcRouter>;
  };
}>;

/** Composes the spend rollup and the allowance reading over this process. */
export function composeSpendFeature(options: {
  infrastructure: ApiTrpcInfrastructure;
  /** The usage reading; absent refuses `limits.*` by name. */
  usage?: ApiUsageStatsPort;
  report?: ApiSpendAbsenceReport;
}): ComposedSpendFeature {
  if (!options.usage) options.report?.absent("usage");
  const prisma = options.infrastructure.prisma;

  const costs: CostTrpcPorts<ApiProjectSpendRollup> = {
    readOrganizationSpend: (input) => readOrganizationSpend(prisma, input),
  };
  const limits = options.usage?.ports() ?? refusingLimits();

  return {
    routers: (mount) => ({
      costs: createCostTrpcRouter({ ...mount, ports: costs }),
      limits: createLimitsTrpcRouter({ ...mount, ports: limits }),
    }),
  };
}

/**
 * Both namespaces on a process that composed no database.
 *
 * They still mount and every call refuses by name, so the billing screen says
 * the deployment cannot answer rather than reporting a spend of zero.
 */
export function refusingSpendFeature(): ComposedSpendFeature {
  const refuse = (): never => {
    throw new ApiSpendUnavailableError("The spend reading");
  };
  const costs = new Proxy(
    {},
    { get: () => refuse, has: () => true },
  ) as CostTrpcPorts<ApiProjectSpendRollup>;

  return {
    routers: (mount) => ({
      costs: createCostTrpcRouter({ ...mount, ports: costs }),
      limits: createLimitsTrpcRouter({ ...mount, ports: refusingLimits() }),
    }),
  };
}

/** The allowance reading a process with no billing store answers with. */
function refusingLimits(): LimitsTrpcPorts {
  return new Proxy(
    {},
    {
      get:
        () =>
        (): never => {
          throw new ApiSpendUnavailableError("The usage reading");
        },
      has: () => true,
    },
  ) as LimitsTrpcPorts;
}

/**
 * One organization's spend, rolled up per project and narrowed to the projects
 * this caller can reach.
 *
 * Two `groupBy` reads rather than one: `TRACE_CHECK` rows are grouped by the
 * evaluator they belong to as well, because the billing screen names each
 * check, and every other cost type is grouped only by type and currency.
 */
async function readOrganizationSpend(
  prisma: PrismaClient,
  input: { organizationId: string; userId: string; startDate: number; endDate: number },
): Promise<ApiProjectSpendRollup[]> {
  const projects = await prisma.project.findMany({
    where: {
      OR: [
        {
          team: {
            organizationId: input.organizationId,
            members: { some: { userId: input.userId } },
          },
        },
        {
          team: {
            organizationId: input.organizationId,
            organization: { members: { some: { userId: input.userId, role: "ADMIN" } } },
          },
        },
      ],
    },
  });
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const projectIds = [...projectsById.keys()];
  const createdAt = { gte: new Date(input.startDate), lte: new Date(input.endDate) };

  const [traceCheckCosts, otherCosts] = await Promise.all([
    prisma.cost.groupBy({
      by: ["projectId", "costType", "referenceId", "costName", "currency"],
      where: { projectId: { in: projectIds }, costType: "TRACE_CHECK", createdAt },
      _sum: { amount: true },
      _count: { id: true },
    }),
    prisma.cost.groupBy({
      by: ["projectId", "costType", "currency"],
      where: { projectId: { in: projectIds }, NOT: { costType: "TRACE_CHECK" }, createdAt },
      _sum: { amount: true },
      _count: { id: true },
    }),
  ]);

  const rollups = new Map<string, { project: Project; costs: unknown[] }>();
  for (const cost of [...traceCheckCosts, ...otherCosts]) {
    const project = projectsById.get(cost.projectId);
    if (!project) continue;
    const rollup = rollups.get(cost.projectId) ?? { project, costs: [] };
    rollup.costs.push(cost);
    rollups.set(cost.projectId, rollup);
  }
  return [...rollups.values()] as ApiProjectSpendRollup[];
}

/** A capability this deployment did not compose, refused by name. */
class ApiSpendUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `${capability} is not available on this deployment.`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiSpendUnavailableError";
  }
}
