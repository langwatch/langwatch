/**
 * Auto-computes scenarioMappings for workflow-linked agents when a workflow version is saved.
 *
 * This is a best-effort, non-blocking operation: any failure is caught and logged
 * so that the workflow save is never blocked.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import type { Edge, Node } from "@xyflow/react";
import { getMappingSurfaceInputs } from "../../optimization_studio/utils/nodeUtils";
import { computeBestMatchMappings } from "../scenarios/execution/resolve-field-mappings";

/** Minimal DSL shape needed for I/O extraction — avoids importing the full Workflow type. */
interface WorkflowDSL {
  nodes: Node[];
  edges: Edge[];
}

/**
 * Extracts normalized inputs and outputs from a workflow DSL.
 *
 * Inputs come from `getMappingSurfaceInputs`, which includes declared entry
 * outputs regardless of whether they have downstream edges. Outputs come from
 * the end node's declared inputs directly.
 *
 * Replicates the client-side extractVariables helper server-side so we do not
 * depend on browser-only modules.
 */
function extractVariablesFromDSL({ dsl }: { dsl: WorkflowDSL }): {
  inputs: Array<{ identifier: string }>;
  outputs: Array<{ identifier: string }>;
} {
  const rawInputs = getMappingSurfaceInputs(dsl.edges, dsl.nodes);

  const inputs = rawInputs.flatMap(
    (i): Array<{ identifier: string }> =>
      typeof i.identifier === "string" ? [{ identifier: i.identifier }] : [],
  );

  const endNodeData = dsl.nodes.find(
    (n) => n.type === "end" || n.id === "end",
  )?.data;
  const rawOutputs: unknown[] = Array.isArray(
    (endNodeData as { inputs?: unknown } | undefined)?.inputs,
  )
    ? (endNodeData as { inputs: unknown[] }).inputs
    : [];

  const outputs = rawOutputs.flatMap(
    (o: unknown): Array<{ identifier: string }> => {
      if (typeof o !== "object" || o === null) return [];
      const field = o as { identifier?: unknown };
      return typeof field.identifier === "string"
        ? [{ identifier: field.identifier }]
        : [];
    },
  );

  return { inputs, outputs };
}

/**
 * Identifiers used by the blank template's entry output and end input.
 * When the workflow still has these exact placeholder fields, the user has not
 * yet designed their workflow, so auto-compute should be skipped.
 */
const BLANK_TEMPLATE_INPUT = "question";
const BLANK_TEMPLATE_OUTPUT = "output";

/**
 * Returns true when the DSL still matches the blank-template placeholders
 * exactly — i.e. the user has not customised their workflow yet.
 */
function isBlankTemplateDSL({
  inputs,
  outputs,
}: {
  inputs: Array<{ identifier: string }>;
  outputs: Array<{ identifier: string }>;
}): boolean {
  return (
    inputs.length === 1 &&
    inputs[0]?.identifier === BLANK_TEMPLATE_INPUT &&
    outputs.length === 1 &&
    outputs[0]?.identifier === BLANK_TEMPLATE_OUTPUT
  );
}

/**
 * The workflow-derived values every agent in a save is reconciled against:
 * the auto-computed best-match mappings, the output field to adopt (if any),
 * and the identifier sets used to detect stale entries.
 */
interface AgentMappingPlan {
  mappings: Record<string, unknown>;
  scenarioOutputField: string | undefined;
  inputIdentifiers: Set<string>;
  outputIdentifiers: Set<string>;
}

function readAgentConfig(config: unknown): Record<string, unknown> {
  return typeof config === "object" && config !== null
    ? (config as Record<string, unknown>)
    : {};
}

function readCurrentMappings(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const existingMappings = config.scenarioMappings;
  return existingMappings !== null &&
    typeof existingMappings === "object" &&
    !Array.isArray(existingMappings)
    ? (existingMappings as Record<string, unknown>)
    : {};
}

/** Preserve mappings whose keys are still valid workflow inputs; drop stale ones. */
function preserveValidMappings(
  currentMappings: Record<string, unknown>,
  inputIdentifiers: Set<string>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(currentMappings).filter(([key]) =>
      inputIdentifiers.has(key),
    ),
  );
}

/**
 * "Changed" means the set of keys differs from current, OR the source
 * of any preserved key changed. Since preservedMappings is a subset of
 * currentMappings (same entries, just filtered), we only need to detect
 * key-set differences between nextMappings and currentMappings.
 */
function hasMappingKeySetChanged({
  currentMappings,
  nextMappings,
}: {
  currentMappings: Record<string, unknown>;
  nextMappings: Record<string, unknown>;
}): boolean {
  const currentKeys = Object.keys(currentMappings);
  const nextKeys = Object.keys(nextMappings);
  return (
    currentKeys.length !== nextKeys.length ||
    currentKeys.some((k) => !(k in nextMappings))
  );
}

/**
 * Evaluate output-field staleness independently from input mappings.
 * Only repair when the existing value is a string that points to a field
 * that no longer exists. Initialize on first auto-compute (no existing
 * mappings + new output available). Don't clobber an intentionally-unset
 * field on agents that already have mappings configured.
 *
 * If the stored output field is stale AND there is no replacement
 * (workflow has no outputs), strip the stale field so the adapter does
 * not try to read a non-existent identifier at run time.
 */
function resolveOutputFieldUpdate({
  config,
  plan,
  hasExistingMappings,
}: {
  config: Record<string, unknown>;
  plan: AgentMappingPlan;
  hasExistingMappings: boolean;
}): { shouldUpdateOutputField: boolean; shouldRemoveOutputField: boolean } {
  const existingOutputField = config.scenarioOutputField;
  const outputFieldIsStale =
    typeof existingOutputField === "string" &&
    !plan.outputIdentifiers.has(existingOutputField);
  return {
    shouldUpdateOutputField:
      plan.scenarioOutputField !== undefined &&
      (outputFieldIsStale ||
        (!hasExistingMappings && existingOutputField === undefined)),
    shouldRemoveOutputField:
      outputFieldIsStale && plan.scenarioOutputField === undefined,
  };
}

/**
 * Reconciles one agent's config against the plan, returning the config to
 * persist — or undefined when nothing about the agent needs to change.
 */
function computeUpdatedAgentConfig({
  config,
  plan,
}: {
  config: Record<string, unknown>;
  plan: AgentMappingPlan;
}): Record<string, unknown> | undefined {
  const currentMappings = readCurrentMappings(config);
  const hasExistingMappings = Object.keys(currentMappings).length > 0;

  // Fill in auto-computed best-match defaults only for inputs the user has
  // not already mapped. This avoids clobbering user-configured mappings
  // when another input becomes stale.
  const nextMappings: Record<string, unknown> = {
    ...plan.mappings,
    ...preserveValidMappings(currentMappings, plan.inputIdentifiers),
  };

  const mappingsChanged =
    hasExistingMappings &&
    hasMappingKeySetChanged({ currentMappings, nextMappings });
  const needsInitialMappings =
    !hasExistingMappings && Object.keys(nextMappings).length > 0;

  const { shouldUpdateOutputField, shouldRemoveOutputField } =
    resolveOutputFieldUpdate({ config, plan, hasExistingMappings });

  if (
    !mappingsChanged &&
    !needsInitialMappings &&
    !shouldUpdateOutputField &&
    !shouldRemoveOutputField
  ) {
    return undefined;
  }

  const baseConfig = shouldRemoveOutputField
    ? Object.fromEntries(
        Object.entries(config).filter(([key]) => key !== "scenarioOutputField"),
      )
    : config;

  return {
    ...baseConfig,
    ...(mappingsChanged || needsInitialMappings
      ? { scenarioMappings: nextMappings }
      : {}),
    ...(shouldUpdateOutputField
      ? { scenarioOutputField: plan.scenarioOutputField }
      : {}),
  };
}

/**
 * Auto-computes and persists scenarioMappings for all workflow-linked agents that
 * have no mappings configured, or whose existing mappings reference stale fields.
 *
 * Skips agents whose workflow still matches the blank-template placeholders.
 *
 * Wrapped in try/catch so that any failure is logged and does not block the
 * calling workflow save.
 */
export async function autoComputeAgentMappings({
  prisma,
  workflowId,
  projectId,
  dsl,
}: {
  prisma: PrismaClient;
  workflowId: string;
  projectId: string;
  dsl: WorkflowDSL;
}): Promise<void> {
  try {
    const agents = await prisma.agent.findMany({
      where: {
        workflowId,
        projectId,
        archivedAt: null,
      },
      select: { id: true, config: true },
    });

    if (agents.length === 0) return;

    const { inputs, outputs } = extractVariablesFromDSL({ dsl });

    // Skip auto-compute for blank-template placeholder workflows
    if (isBlankTemplateDSL({ inputs, outputs })) return;

    const plan: AgentMappingPlan = {
      mappings: computeBestMatchMappings({ inputs }),
      scenarioOutputField:
        outputs[0]?.identifier !== undefined
          ? outputs[0].identifier
          : undefined,
      inputIdentifiers: new Set(inputs.map((i) => i.identifier)),
      outputIdentifiers: new Set(outputs.map((o) => o.identifier)),
    };

    for (const agent of agents) {
      const updatedConfig = computeUpdatedAgentConfig({
        config: readAgentConfig(agent.config),
        plan,
      });
      if (!updatedConfig) {
        continue;
      }

      await prisma.agent.update({
        where: { id: agent.id, projectId },
        data: { config: updatedConfig as Prisma.InputJsonValue },
      });
    }
  } catch (error) {
    console.error(
      "[autoComputeAgentMappings] Failed to auto-compute agent mappings:",
      error,
    );
  }
}
