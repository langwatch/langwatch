/**
 * The LangWatchQL schema for the signed-in member, mapped for the workbench.
 *
 * Fetched once and left alone: every background refresh option is off, because
 * the surface makes exactly one promise about when it talks to the server, and
 * a schema that reloaded itself would break it just as surely as a rerunning
 * query would.
 *
 * @see packages/features/analytics/specs/analytics-lwql-workbench.feature
 */

import { useMemo } from "react";

import { api } from "~/utils/api";

import { type LangWatchQLSchemaModel, lwqlSchemaModel } from "../logic/lwqlSchemaModel";

export interface UseLangWatchQLSchema {
  /** Exactly what the endpoint returned, shaped for the browser and editor. */
  model: LangWatchQLSchemaModel;
  isLoading: boolean;
  /** The failure, for the surface to present through the error registry. */
  error: unknown;
}

export function useLangWatchQLSchema({
  projectId,
}: {
  projectId: string;
}): UseLangWatchQLSchema {
  const query = api.analytics.lwql.schema.useQuery(
    { projectId },
    {
      enabled: projectId.length > 0,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
      // The catalog does not change under a member mid-session, and a refetch
      // that reshuffled the browser while they were reading it would be a
      // change they did not ask for.
      staleTime: Number.POSITIVE_INFINITY,
    },
  );

  const model = useMemo(() => lwqlSchemaModel(query.data), [query.data]);

  return { model, isLoading: query.isLoading, error: query.error };
}
