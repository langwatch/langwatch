import type { LucideIcon } from "lucide-react";
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
import type { SearchResult } from "./types";

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
    pathBuilder: (id, p) =>
      `/${p}/agents?drawer.open=agentViewer&drawer.agentId=${id}`,
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
    pathBuilder: (id, p) =>
      `/${p}/evaluators?drawer.open=evaluatorViewer&drawer.evaluatorId=${id}`,
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
export function findEntityByPrefix(
  query: string
): EntityConfig | undefined {
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
