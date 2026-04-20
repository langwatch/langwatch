/**
 * Auto-computes scenarioMappings for workflow-linked agents when a workflow version is saved.
 *
 * This is a best-effort, non-blocking operation: any failure is caught and logged
 * so that the workflow save is never blocked.
 */

import type { PrismaClient } from "@prisma/client";
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
    inputs[0]!.identifier === BLANK_TEMPLATE_INPUT &&
    outputs.length === 1 &&
    outputs[0]!.identifier === BLANK_TEMPLATE_OUTPUT
  );
}

/**
 * Returns true when the agent's existing scenarioMappings contain at least one
 * key that no longer exists as a workflow input identifier (stale mapping).
 */
function hasStaleMappings({
  existingMappings,
  inputs,
}: {
  existingMappings: Record<string, unknown>;
  inputs: Array<{ identifier: string }>;
}): boolean {
  const inputIdentifiers = new Set(inputs.map((i) => i.identifier));
  return Object.keys(existingMappings).some((key) => !inputIdentifiers.has(key));
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

    for (const agent of agents) {
      const config =
        typeof agent.config === "object" && agent.config !== null
          ? (agent.config as Record<string, unknown>)
          : {};

      const existingMappings = config["scenarioMappings"];
      const hasExistingMappings =
        existingMappings !== undefined &&
        existingMappings !== null &&
        typeof existingMappings === "object" &&
        Object.keys(existingMappings).length > 0;

      if (hasExistingMappings) {
        // Re-compute only when existing mappings reference fields that no longer exist
        const stale = hasStaleMappings({
          existingMappings: existingMappings as Record<string, unknown>,
          inputs,
        });
        if (!stale) continue;
      }

      // Skip if there are no mappings to apply
      if (Object.keys(mappings).length === 0) continue;

      const updatedConfig: Record<string, unknown> = {
        ...config,
        scenarioMappings: mappings,
        ...(scenarioOutputField !== undefined
          ? { scenarioOutputField }
          : {}),
      };

      await prisma.agent.update({
        where: { id: agent.id, projectId },
        data: { config: updatedConfig },
      });
    }
  } catch (error) {
    console.error(
      "[autoComputeAgentMappings] Failed to auto-compute agent mappings:",
      error,
    );
  }
}
