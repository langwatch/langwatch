/**
 * Whether a project may write a judged column.
 *
 * Three conditions, all server-side, and all have to hold:
 *
 *  - the feature flag is on for the project, which is the product decision;
 *  - a classifier is configured for the deployment, which is the operational
 *    one. Publishing the functions as available where nothing can answer them
 *    would put a caller in front of a query that always comes back null;
 *  - that classifier can judge for the project's organization. A connected
 *    self-hosted install judges on LangWatch, and an organization admin
 *    switches that on per organization (ADR-141), so one that has not
 *    switched it on is in the same position as a deployment with nothing
 *    configured.
 *
 * Mirrors `~/server/analytics/lwql/access.ts`, including the two rules its
 * comment makes load-bearing: the organization is always resolved and passed,
 * because an organization-scoped rule fails closed without it and a rollout
 * would silently do nothing; and the distinct identity is the **project**,
 * never the member, because a REST caller is an API key with no member behind
 * it and a percentage rule must not open the surface for one teammate and close
 * it for another.
 *
 * @see ../../analytics/lwql/access.ts
 * @see ../../../../specs/lwql/eval-functions.feature
 */

import type { PrismaClient } from "~/generated/prisma/client";
import { featureFlagService } from "~/server/featureFlag";
import { NOT_TARGETED } from "~/server/featureFlag/targeting";
import {
  isInstantEvalClassifierAvailableForOrganization,
  isInstantEvalClassifierConfigured,
} from "./classifier";

export const INSTANT_EVALS_FLAG = "release_instant_evals";

/**
 * The product decision alone: whether the flag is on for the project, whatever
 * the deployment has configured. The search router reads this one, because a
 * released project with no classifier still gets the "configure a model"
 * primer, while an unreleased one is never offered a judgement at all.
 */
export async function instantEvalsReleased({
  prisma,
  projectId,
  organizationId,
}: {
  prisma: PrismaClient;
  projectId: string;
  /**
   * The project's organization, where the caller already has it. Resolved here
   * otherwise, so the common call stays a single argument pair.
   */
  organizationId?: string;
}): Promise<boolean> {
  const resolved =
    organizationId ?? (await organizationOf({ prisma, projectId }));

  return featureFlagService.isEnabled(INSTANT_EVALS_FLAG, {
    distinctId: projectId,
    projectId,
    organizationId: resolved ?? NOT_TARGETED,
  });
}

async function organizationOf({
  prisma,
  projectId,
}: {
  prisma: PrismaClient;
  projectId: string;
}): Promise<string | undefined> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { team: { select: { organizationId: true } } },
  });
  return project?.team?.organizationId;
}

export async function instantEvalsEnabled({
  prisma,
  projectId,
  isClassifierConfigured = isInstantEvalClassifierConfigured,
  isClassifierAvailableForOrganization = isInstantEvalClassifierAvailableForOrganization,
}: {
  prisma: PrismaClient;
  projectId: string;
  /**
   * Reads the deployment's configuration, injectable so a test can state the
   * operational condition instead of inheriting whatever the ambient
   * environment happens to say about it.
   */
  isClassifierConfigured?: () => boolean;
  /** The same, for the condition the organization owns rather than the install. */
  isClassifierAvailableForOrganization?: (
    organizationId: string,
  ) => Promise<boolean>;
}): Promise<boolean> {
  if (!isClassifierConfigured()) return false;

  const organizationId = await organizationOf({ prisma, projectId });

  if (
    organizationId &&
    !(await isClassifierAvailableForOrganization(organizationId))
  ) {
    return false;
  }

  return instantEvalsReleased({ prisma, projectId, organizationId });
}
