import { TRACE_INDEX, esClient } from "../../elasticsearch";
import type { QueryDslBoolQuery } from "@elastic/elasticsearch/lib/api/types";
import { prisma } from "../../db";
import { dependencies } from "../../../injection/dependencies.server";

// Utility functions extracted from limits router to avoid circular dependencies
// These don't depend on UsageLimitService, so they can be imported by otel routes safely

type CacheEntry = {
  count: number;
  lastUpdated: number;
};

const FIVE_MINUTES = 5 * 60 * 1000;
const messageCountCache = new Map<string, CacheEntry>();

const getCurrentMonth = () => {
  return new Date(new Date().getFullYear(), new Date().getMonth(), 1);
};

export const getProjectIdsForOrganization = async (
  organizationId: string,
): Promise<string[]> => {
  return (
    await prisma.project.findMany({
      where: {
        team: { organizationId },
      },
      select: { id: true },
    })
  ).map((project) => project.id);
};

export const getCurrentMonthMessagesCount = async (
  projectIds: string[],
  organizationId?: string,
) => {
  const cacheKey = organizationId
    ? `org:${organizationId}`
    : `projects:${projectIds.sort().join(",")}`;

  const now = Date.now();
  const cachedResult = messageCountCache.get(cacheKey);

  // Return cached result if valid
  if (cachedResult && now - cachedResult.lastUpdated < FIVE_MINUTES) {
    return cachedResult.count;
  }

  let projectIdsToUse = projectIds;
  if (organizationId) {
    projectIdsToUse = await getProjectIdsForOrganization(organizationId);
  }

  const client = await esClient({ projectId: projectIdsToUse[0] ?? "" });
  const messagesCount = await client.count({
    index: TRACE_INDEX.alias,
    body: {
      query: {
        bool: {
          must: [
            {
              terms: {
                project_id: projectIds,
              },
            },
            {
              range: {
                "timestamps.inserted_at": {
                  gte: getCurrentMonth().getTime(),
                },
              },
            },
          ] as QueryDslBoolQuery["filter"],
        } as QueryDslBoolQuery,
      },
    },
  });

  // Store result in cache
  messageCountCache.set(cacheKey, {
    count: messagesCount.count,
    lastUpdated: now,
  });

  return messagesCount.count;
};

export const getCurrentMonthCostForProjects = async (projectIds: string[]) => {
  return (
    (
      await prisma.cost.aggregate({
        where: {
          projectId: {
            in: projectIds,
          },
          createdAt: {
            gte: getCurrentMonth(),
          },
        },
        _sum: {
          amount: true,
        },
      })
    )._sum?.amount ?? 0
  );
};

export const maxMonthlyUsageLimit = async (organizationId: string) => {
  const activePlan =
    await dependencies.subscriptionHandler.getActivePlan(organizationId);
  if (activePlan.name === "Open Source") {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
    });

    return organization?.usageSpendingMaxLimit ?? Infinity;
  }
  if (activePlan.evaluationsCredit < 10) {
    return activePlan.evaluationsCredit;
  }

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
  });

  // TODO: improve this logic to be based on subscription history
  const maxLimitAccordingToSubscription = activePlan.prices.USD;
  const maxLimitAccordingToUser =
    organization?.usageSpendingMaxLimit ?? maxLimitAccordingToSubscription;

  return Math.min(maxLimitAccordingToSubscription, maxLimitAccordingToUser);
};

