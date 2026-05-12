/**
 * Auto-computes scenarioMappings for workflow-linked agents when a workflow version is saved.
 *
 * This is a best-effort, non-blocking operation: any failure is caught and logged
 * so that the workflow save is never blocked.
 */

import type { PrismaClient, Prisma } from "@prisma/client";
import type { Edge, Node } from "@xyflow/react";
import { computeBestMatchMappings } from "../scenarios/execution/resolve-field-mappings";
import { getInputsOutputs } from "../../optimization_studio/utils/nodeUtils";

/** Minimal DSL shape needed for I/O extraction — avoids importing the full Workflow type. */
interface WorkflowDSL {
  nodes: Node[];
  edges: Edge[];
}

/**
 * Extracts normalized inputs and outputs from a workflow DSL.
 *
 * Replicates the client-side extractVariables helper server-side so we do not
 * depend on browser-only modules.
 */
function extractVariablesFromDSL({ dsl }: { dsl: WorkflowDSL }): {
  inputs: Array<{ identifier: string }>;
  outputs: Array<{ identifier: string }>;
} {
  const { inputs: rawInputs, outputs: rawOutputs } = getInputsOutputs(
    dsl.edges,
    dsl.nodes,
  );

  const inputs = (rawInputs ?? []).flatMap(
    (i): Array<{ identifier: string }> =>
      typeof i.identifier === "string" ? [{ identifier: i.identifier }] : [],
  );

  const outputs = (Array.isArray(rawOutputs) ? rawOutputs : []).flatMap(
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

    const mappings = computeBestMatchMappings({ inputs });
    const scenarioOutputField =
      outputs[0]?.identifier !== undefined ? outputs[0].identifier : undefined;

    const inputIdentifiers = new Set(inputs.map((i) => i.identifier));
    const outputIdentifiers = new Set(outputs.map((o) => o.identifier));

    for (const agent of agents) {
      const config =
        typeof agent.config === "object" && agent.config !== null
          ? (agent.config as Record<string, unknown>)
          : {};

      const existingMappings = config["scenarioMappings"];
      const currentMappings =
        existingMappings !== null &&
        typeof existingMappings === "object" &&
        !Array.isArray(existingMappings)
          ? (existingMappings as Record<string, unknown>)
          : {};
      const hasExistingMappings = Object.keys(currentMappings).length > 0;

      // Preserve mappings whose keys are still valid workflow inputs; drop stale ones.
      const preservedMappings = Object.fromEntries(
        Object.entries(currentMappings).filter(([key]) =>
          inputIdentifiers.has(key),
        ),
      );

      // Fill in auto-computed best-match defaults only for inputs the user has
      // not already mapped. This avoids clobbering user-configured mappings
      // when another input becomes stale.
      const nextMappings: Record<string, unknown> = {
        ...mappings,
        ...preservedMappings,
      };

      // "Changed" means the set of keys differs from current, OR the source
      // of any preserved key changed. Since preservedMappings is a subset of
      // currentMappings (same entries, just filtered), we only need to detect
      // key-set differences between nextMappings and currentMappings.
      const currentKeys = Object.keys(currentMappings);
      const nextKeys = Object.keys(nextMappings);
      const mappingsChanged =
        hasExistingMappings &&
        (currentKeys.length !== nextKeys.length ||
          currentKeys.some((k) => !(k in nextMappings)));
      const needsInitialMappings =
        !hasExistingMappings && Object.keys(nextMappings).length > 0;

      // Evaluate output-field staleness independently from input mappings.
      // Only repair when the existing value is a string that points to a field
      // that no longer exists. Initialize on first auto-compute (no existing
      // mappings + new output available). Don't clobber an intentionally-unset
      // field on agents that already have mappings configured.
      const existingOutputField = config["scenarioOutputField"];
      const outputFieldIsStale =
        typeof existingOutputField === "string" &&
        !outputIdentifiers.has(existingOutputField);
      const shouldUpdateOutputField =
        scenarioOutputField !== undefined &&
        (outputFieldIsStale ||
          (!hasExistingMappings && existingOutputField === undefined));
      // If the stored output field is stale AND there is no replacement
      // (workflow has no outputs), strip the stale field so the adapter does
      // not try to read a non-existent identifier at run time.
      const shouldRemoveOutputField =
        outputFieldIsStale && scenarioOutputField === undefined;

      if (
        !mappingsChanged &&
        !needsInitialMappings &&
        !shouldUpdateOutputField &&
        !shouldRemoveOutputField
      ) {
        continue;
      }

      const baseConfig = shouldRemoveOutputField
        ? Object.fromEntries(
            Object.entries(config).filter(
              ([key]) => key !== "scenarioOutputField",
            ),
          )
        : config;

      const updatedConfig: Record<string, unknown> = {
        ...baseConfig,
        ...((mappingsChanged || needsInitialMappings)
          ? { scenarioMappings: nextMappings }
          : {}),
        ...(shouldUpdateOutputField ? { scenarioOutputField } : {}),
      };

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
