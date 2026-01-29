import { useMemo } from "react";
import { useDebounceValue } from "usehooks-ts";
import {
  Bot,
  BookText,
  ListTree,
  Percent,
  Table,
  Workflow,
  Play,
  Bell,
  FlaskConical,
} from "lucide-react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useAllPromptsForProject } from "~/prompts/hooks/useAllPromptsForProject";
import { api } from "~/utils/api";
import type { SearchResult } from "./types";

/**
 * Entity ID prefixes for direct navigation.
 * Maps prefix to entity type and path builder.
 */
const ENTITY_PREFIXES: Record<
  string,
  {
    type: SearchResult["type"];
    icon: SearchResult["icon"];
    label: string;
    pathBuilder: (id: string, projectSlug: string) => string;
  }
> = {
  agent_: {
    type: "agent",
    icon: Bot,
    label: "Agent",
    pathBuilder: (id, p) =>
      `/${p}/agents?drawer.open=agentViewer&drawer.agentId=${id}`,
  },
  dataset_: {
    type: "dataset",
    icon: Table,
    label: "Dataset",
    pathBuilder: (id, p) => `/${p}/datasets/${id}`,
  },
  evaluator_: {
    type: "evaluator",
    icon: Percent,
    label: "Evaluator",
    pathBuilder: (id, p) =>
      `/${p}/evaluators?drawer.open=evaluatorViewer&drawer.evaluatorId=${id}`,
  },
  experiment_: {
    type: "workflow",
    icon: FlaskConical,
    label: "Experiment",
    pathBuilder: (id, p) => `/${p}/experiments/${id}`,
  },
  prompt_: {
    type: "prompt",
    icon: BookText,
    label: "Prompt",
    pathBuilder: (id, p) => `/${p}/prompts?handle=${id}`,
  },
  workflow_: {
    type: "workflow",
    icon: Workflow,
    label: "Workflow",
    pathBuilder: (id, p) => `/${p}/workflows/${id}`,
  },
  scen_: {
    type: "workflow",
    icon: Play,
    label: "Scenario",
    pathBuilder: (id, p) => `/${p}/simulations/scenarios/${id}`,
  },
  monitor_: {
    type: "workflow",
    icon: Bell,
    label: "Trigger",
    pathBuilder: (id, p) => `/${p}/triggers/${id}`,
  },
};

// OpenTelemetry trace ID format (128-bit hex)
const OTEL_TRACE_ID_REGEX = /^[0-9a-f]{32}$/i;
// OpenTelemetry span ID format (64-bit hex)
const OTEL_SPAN_ID_REGEX = /^[0-9a-f]{16}$/i;
// Prefixed trace format
const TRACE_PREFIX_REGEX = /^trace_/i;
// Prefixed span format
const SPAN_PREFIX_REGEX = /^span_/i;

/**
 * Detect if the query is an entity ID and return navigation info.
 */
function detectEntityId(
  query: string,
  projectSlug: string
): SearchResult | null {
  const trimmedQuery = query.trim();
  if (!trimmedQuery || !projectSlug) return null;

  // Check KSUID-prefixed entities
  for (const [prefix, config] of Object.entries(ENTITY_PREFIXES)) {
    if (trimmedQuery.startsWith(prefix)) {
      return {
        id: `id-${trimmedQuery}`,
        label: `Go to ${config.label}`,
        description: trimmedQuery,
        icon: config.icon,
        path: config.pathBuilder(trimmedQuery, projectSlug),
        type: config.type,
      };
    }
  }

  // Check for trace ID patterns
  if (
    TRACE_PREFIX_REGEX.test(trimmedQuery) ||
    OTEL_TRACE_ID_REGEX.test(trimmedQuery)
  ) {
    return {
      id: `trace-${trimmedQuery}`,
      label: "Open trace",
      description: trimmedQuery,
      icon: ListTree,
      path: `/${projectSlug}/messages/${trimmedQuery}`,
      type: "trace",
      drawerAction: {
        drawer: "traceDetails",
        params: { traceId: trimmedQuery },
      },
    };
  }

  // Check for span ID patterns
  if (
    SPAN_PREFIX_REGEX.test(trimmedQuery) ||
    OTEL_SPAN_ID_REGEX.test(trimmedQuery)
  ) {
    return {
      id: `span-${trimmedQuery}`,
      label: "Find span in traces",
      description: trimmedQuery,
      icon: ListTree,
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
  const [debouncedQuery] = useDebounceValue(query, 300);
  const shouldSearch = debouncedQuery.length >= 2;

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
    if (query.trim().length < 2) return null;
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
