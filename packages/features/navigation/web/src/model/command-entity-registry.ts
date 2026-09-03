import type { LucideIcon } from "lucide-react";
import {
  Bell,
  BookText,
  Bot,
  FlaskConical,
  ListTree,
  Percent,
  Play,
  Table,
  Workflow,
} from "lucide-react";
import type { AgentType } from "@langwatch/agent-contract";

import type { SearchResult } from "./command-bar-types";

/**
 * The address the whole product uses for ONE agent.
 *
 * Three editors, one per kind, and the kind is what picks between them — the
 * same rule `apps/api`'s `createAgentPlatformUrlBuilder` applies when it mints
 * an agent's link for the REST API and for Langy's deep links, and the same one
 * `@langwatch/agent-web`'s `getAgentEditorDrawer` applies on the agents page.
 *
 * WHAT THIS ONE ANSWERS THAT NEITHER OF THOSE DOES is "and what if there is no
 * editor". A signature agent has none, and the command bar lists every agent
 * the project has, so `null` is a real answer here where agent-web's version
 * throws: a palette that threw on a search result would take the whole overlay
 * down for a kind of agent that is perfectly valid.
 *
 * `agentViewer` USED TO BE THE ANSWER and never worked. It was in no drawer
 * registry, had no component, and every agent hit in the palette wrote it — so
 * the reader clicked and the page did not move. Recorded in
 * `dev/docs/plans/ownerless-ui-surfaces-census.md` as the one ownerless drawer
 * that never existed in the first place.
 */
export type AgentEditorDrawerName =
  | "agentCodeEditor"
  | "agentHttpEditor"
  | "agentWorkflowEditor"
  | "agentConnectedDetail";

export function agentEditorDrawerForType(type: AgentType): AgentEditorDrawerName | null {
  switch (type) {
    case "code":
      return "agentCodeEditor";
    case "http":
      return "agentHttpEditor";
    case "workflow":
      return "agentWorkflowEditor";
    /**
     * A connected agent has no editor — the SDK registered it from a decorated
     * function, so there is nothing here to edit — but it does have a place to
     * be looked at, which is the drawer the agents page itself opens for one.
     * Sending the palette there is the same promise the three editors make:
     * the hit you clicked is what fills the screen.
     */
    case "connected":
      return "agentConnectedDetail";
    case "signature":
      return null;
  }
}

/**
 * Where a search hit on an agent goes.
 *
 * With no editor for its kind — and from the id-paste path, which carries no
 * kind at all — the agents list is the honest destination: the reader lands
 * where every agent is, rather than on an address that opens nothing.
 */
export function agentPath({
  projectSlug,
  agentId,
  type,
}: {
  projectSlug: string;
  agentId: string;
  type?: AgentType;
}): string {
  const drawer = type ? agentEditorDrawerForType(type) : null;
  if (!drawer) return `/${projectSlug}/agents`;
  return `/${projectSlug}/agents?drawer.open=${drawer}&drawer.agentId=${encodeURIComponent(agentId)}`;
}

/**
 * Entity configuration for command bar ID detection.
 * Add new entity types here to extend the command bar's ID detection capability.
 */
export interface EntityConfig {
  /** Prefix used to identify this entity type (e.g., "agent_", "dataset_") */
  prefix: string;
  /** Type identifier for search results */
  type: SearchResult["type"];
  /** Icon component for display */
  icon: LucideIcon;
  /** Human-readable label */
  label: string;
  /** Function to build the path for this entity */
  pathBuilder: (id: string, projectSlug: string) => string;
}

/**
 * Registry of entity types for ID-based navigation.
 * Centralizes entity configuration to avoid hardcoding throughout the codebase.
 *
 * To add a new entity type:
 * 1. Add a new EntityConfig to this array
 * 2. Update SearchResult["type"] in types.ts if needed
 */
export const entityRegistry: EntityConfig[] = [
  {
    prefix: "agent_",
    type: "agent",
    icon: Bot,
    label: "Agent",
    // An id pasted into the palette carries no kind, and the kind is what
    // picks the editor — so this lands on the agents list rather than guessing
    // one of three drawers and being wrong two-thirds of the time.
    pathBuilder: (id, p) => agentPath({ projectSlug: p, agentId: id }),
  },
  {
    prefix: "dataset_",
    type: "dataset",
    icon: Table,
    label: "Dataset",
    pathBuilder: (id, p) => `/${p}/datasets/${id}`,
  },
  {
    prefix: "evaluator_",
    type: "evaluator",
    icon: Percent,
    label: "Evaluator",
    pathBuilder: (id, p) => `/${p}/evaluators?drawer.open=evaluatorEditor&drawer.evaluatorId=${id}`,
  },
  {
    prefix: "experiment_",
    type: "workflow",
    icon: FlaskConical,
    label: "Experiment",
    pathBuilder: (id, p) => `/${p}/experiments/${id}`,
  },
  {
    prefix: "prompt_",
    type: "prompt",
    icon: BookText,
    label: "Prompt",
    pathBuilder: (id, p) => `/${p}/prompts?handle=${id}`,
  },
  {
    prefix: "workflow_",
    type: "workflow",
    icon: Workflow,
    label: "Workflow",
    pathBuilder: (id, p) => `/${p}/workflows/${id}`,
  },
  {
    prefix: "scenario_",
    type: "workflow",
    icon: Play,
    label: "Scenario",
    pathBuilder: (id, p) => `/${p}/simulations/scenarios/${id}`,
  },
  {
    prefix: "scen_",
    type: "workflow",
    icon: Play,
    label: "Scenario",
    pathBuilder: (id, p) => `/${p}/simulations/scenarios/${id}`,
  },
  {
    prefix: "monitor_",
    type: "workflow",
    icon: Bell,
    label: "Trigger",
    pathBuilder: (id, p) => `/${p}/triggers/${id}`,
  },
];

/**
 * Find entity configuration by prefix.
 * Returns undefined if no matching entity is found.
 */
export function findEntityByPrefix(query: string): EntityConfig | undefined {
  return entityRegistry.find((entity) => query.startsWith(entity.prefix));
}

// OpenTelemetry trace ID format (128-bit hex)
export const OTEL_TRACE_ID_REGEX = /^[0-9a-f]{32}$/i;
// OpenTelemetry span ID format (64-bit hex)
export const OTEL_SPAN_ID_REGEX = /^[0-9a-f]{16}$/i;
// Prefixed trace format
export const TRACE_PREFIX_REGEX = /^trace_/i;
// Prefixed span format
export const SPAN_PREFIX_REGEX = /^span_/i;

/**
 * Trace/span icon for display.
 */
export const traceIcon = ListTree;

/**
 * Detect if query is a trace ID.
 */
export function isTraceId(query: string): boolean {
  return TRACE_PREFIX_REGEX.test(query) || OTEL_TRACE_ID_REGEX.test(query);
}

/**
 * Detect if query is a span ID.
 */
export function isSpanId(query: string): boolean {
  return SPAN_PREFIX_REGEX.test(query) || OTEL_SPAN_ID_REGEX.test(query);
}
