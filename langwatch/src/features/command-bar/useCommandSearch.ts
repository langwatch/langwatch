import { useMemo } from "react";
import { useDebounceValue } from "usehooks-ts";
import { Bot, BookText, Percent, Table, Workflow } from "lucide-react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useAllPromptsForProject } from "~/prompts/hooks/useAllPromptsForProject";
import { api } from "~/utils/api";
import type { SearchResult } from "./types";
import { SEARCH_DEBOUNCE_MS, MIN_SEARCH_QUERY_LENGTH } from "./constants";
import {
  findEntityByPrefix,
  isTraceId,
  isSpanId,
  traceIcon,
} from "./entityRegistry";

/**
 * Detect if the query is an entity ID and return navigation info.
 * Exported for testing.
 */
export function detectEntityId(
  query: string,
  projectSlug: string
): SearchResult | null {
  const trimmedQuery = query.trim();
  if (!trimmedQuery || !projectSlug) return null;

  // Check KSUID-prefixed entities using the registry
  const entityConfig = findEntityByPrefix(trimmedQuery);
  if (entityConfig) {
    return {
      id: `id-${trimmedQuery}`,
      label: `Go to ${entityConfig.label}`,
      description: trimmedQuery,
      icon: entityConfig.icon,
      path: entityConfig.pathBuilder(trimmedQuery, projectSlug),
      type: entityConfig.type,
    };
  }

  // Check for trace ID patterns
  if (isTraceId(trimmedQuery)) {
    return {
      id: `trace-${trimmedQuery}`,
      label: "Open trace",
      description: trimmedQuery,
      icon: traceIcon,
      path: `/${projectSlug}/messages/${trimmedQuery}`,
      type: "trace",
      drawerAction: {
        drawer: "traceDetails",
        params: { traceId: trimmedQuery },
      },
    };
  }

  // Check for span ID patterns
  if (isSpanId(trimmedQuery)) {
    return {
      id: `span-${trimmedQuery}`,
      label: "Find span in traces",
      description: trimmedQuery,
      icon: traceIcon,
      path: `/${projectSlug}/messages?query=${encodeURIComponent(trimmedQuery)}`,
      type: "trace",
    };
  }

  return null;
}

/**
 * Hook for searching entities (prompts, agents, datasets, workflows, evaluators).
 * Uses debounced query to prevent excessive API calls.
 */
export function useCommandSearch(query: string) {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const projectSlug = project?.slug ?? "";

  // Debounce the query to prevent excessive filtering
  const [debouncedQuery] = useDebounceValue(query, SEARCH_DEBOUNCE_MS);
  const shouldSearch = debouncedQuery.length >= MIN_SEARCH_QUERY_LENGTH;

  // Fetch all entities - queries only run when project is available
  const { data: prompts, isLoading: promptsLoading } =
    useAllPromptsForProject();

  const { data: agents, isLoading: agentsLoading } = api.agents.getAll.useQuery(
    { projectId },
    { enabled: !!projectId }
  );

  const { data: datasets, isLoading: datasetsLoading } =
    api.dataset.getAll.useQuery({ projectId }, { enabled: !!projectId });

  const { data: workflows, isLoading: workflowsLoading } =
    api.workflow.getAll.useQuery({ projectId }, { enabled: !!projectId });

  const { data: evaluators, isLoading: evaluatorsLoading } =
    api.evaluators.getAll.useQuery({ projectId }, { enabled: !!projectId });

  const isLoading =
    promptsLoading ||
    agentsLoading ||
    datasetsLoading ||
    workflowsLoading ||
    evaluatorsLoading;

  // Detect ID-based navigation (immediate, no debounce needed)
  const idResult = useMemo<SearchResult | null>(() => {
    if (query.trim().length < MIN_SEARCH_QUERY_LENGTH) return null;
    return detectEntityId(query, projectSlug);
  }, [query, projectSlug]);

  // Filter and transform results
  const searchResults = useMemo<SearchResult[]>(() => {
    if (!shouldSearch) return [];

    const lowerQuery = debouncedQuery.toLowerCase();
    const results: SearchResult[] = [];

    // Filter prompts
    prompts
      ?.filter((p) => p.handle && p.handle.toLowerCase().includes(lowerQuery))
      .forEach((p) => {
        results.push({
          id: `prompt-${p.id}`,
          label: p.handle!,
          description: `Prompt v${p.version}`,
          icon: BookText,
          path: `/${projectSlug}/prompts?handle=${encodeURIComponent(p.handle!)}`,
          type: "prompt",
        });
      });

    // Filter agents
    agents
      ?.filter((a) => a.name.toLowerCase().includes(lowerQuery))
      .forEach((a) => {
        results.push({
          id: `agent-${a.id}`,
          label: a.name,
          description: "Agent",
          icon: Bot,
          path: `/${projectSlug}/agents?drawer.open=agentViewer&drawer.agentId=${a.id}`,
          type: "agent",
        });
      });

    // Filter datasets
    datasets
      ?.filter((d) => d.name.toLowerCase().includes(lowerQuery))
      .forEach((d) => {
        results.push({
          id: `dataset-${d.id}`,
          label: d.name,
          description: "Dataset",
          icon: Table,
          path: `/${projectSlug}/datasets/${d.id}`,
          type: "dataset",
        });
      });

    // Filter workflows
    workflows
      ?.filter((w) => w.name.toLowerCase().includes(lowerQuery))
      .forEach((w) => {
        results.push({
          id: `workflow-${w.id}`,
          label: w.name,
          description: "Workflow",
          icon: Workflow,
          path: `/${projectSlug}/workflows/${w.id}`,
          type: "workflow",
        });
      });

    // Filter evaluators
    evaluators
      ?.filter((e) => e.name.toLowerCase().includes(lowerQuery))
      .forEach((e) => {
        results.push({
          id: `evaluator-${e.id}`,
          label: e.name,
          description: "Evaluator",
          icon: Percent,
          path: `/${projectSlug}/evaluators?drawer.open=evaluatorViewer&drawer.evaluatorId=${e.id}`,
          type: "evaluator",
        });
      });

    return results;
  }, [
    shouldSearch,
    debouncedQuery,
    prompts,
    agents,
    datasets,
    workflows,
    evaluators,
    projectSlug,
  ]);

  return {
    idResult,
    searchResults,
    isLoading: shouldSearch && isLoading,
  };
}
