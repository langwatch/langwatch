/** The home's recent items: audit-log answers the touches, each owner's list names them. */

import { annotationClient } from "@langwatch/annotation-client";
import { datasetClient } from "@langwatch/dataset-client";
import { monitorClient } from "@langwatch/monitor-client";
import { promptClient } from "@langwatch/prompt-client";
import { workflowClient } from "@langwatch/workflow-client";
import { keepPreviousData } from "@tanstack/react-query";

import {
  composeRecentItems,
  type NamedRecentItemType,
  type RecentItemOwnerEntities,
  type RecentItemOwnerEntity,
  recentItemTypesToResolve,
} from "../model/recent-item-composition.ts";
import { homeApi, type RecentItem } from "./home-api.ts";

/** One recent item as the home renders it: the touch, named and linked by its owner. */
export type HomeRecentItem = RecentItem & { name: string; href: string };

/** Paint from cache, refresh quietly: the strip should not sit in a skeleton on every visit. */
const CACHE = { staleTime: 60_000, gcTime: 10 * 60_000 } as const;

function named(
  rows: readonly Readonly<{ id: string; name: string }>[] | undefined,
): RecentItemOwnerEntity[] | undefined {
  return rows?.map(({ id, name }) => ({ id, name }));
}

/**
 * Each owner list asks its own permission; a list the member cannot read answers nothing, so its
 * rows drop out. Loading holds until the touches and every list they need have settled.
 */
export function useRecentItems({
  projectId,
  projectSlug,
  limit,
}: {
  projectId: string | undefined;
  projectSlug: string | undefined;
  limit: number;
}) {
  const touches = homeApi.home.getRecentItems.useQuery(
    { projectId: projectId ?? "", limit },
    { enabled: !!projectId, placeholderData: keepPreviousData, ...CACHE },
  );

  const types = recentItemTypesToResolve({ touches: touches.data ?? [] });
  const scope = { projectId: projectId ?? "" };
  const ask = (type: NamedRecentItemType) => ({
    enabled: !!projectId && types.has(type),
    ...CACHE,
  });

  const prompts = promptClient.prompts.getAllPromptsForProject.useQuery(scope, ask("prompt"));
  const workflows = workflowClient.workflow.getAll.useQuery(scope, ask("workflow"));
  const datasets = datasetClient.dataset.getAll.useQuery(scope, ask("dataset"));
  const monitors = monitorClient.monitors.getAllForProject.useQuery(scope, ask("evaluation"));
  const queues = annotationClient.annotation.getQueues.useQuery(scope, ask("annotation"));

  const isLoading = [touches, prompts, workflows, datasets, monitors, queues].some(
    (query) => query.isLoading,
  );

  const entities: RecentItemOwnerEntities = {
    prompt: named(prompts.data),
    workflow: named(workflows.data),
    dataset: named(datasets.data),
    evaluation: named(monitors.data),
    annotation: queues.data?.map(({ id, name, slug }) => ({ id, name, slug })),
  };

  const data: HomeRecentItem[] | undefined =
    isLoading || touches.data === undefined
      ? undefined
      : composeRecentItems({ touches: touches.data, projectSlug: projectSlug ?? "", entities });

  return { data, isLoading, error: touches.error, refetch: touches.refetch };
}
