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
 * Auto-computes and persists scenarioMappings for all workflow-linked agents that
 * have no mappings configured.
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

    const mappings = computeBestMatchMappings({ inputs });
    const scenarioOutputField =
      outputs[0]?.identifier !== undefined ? outputs[0].identifier : undefined;

    for (const agent of agents) {
      const config =
        typeof agent.config === "object" && agent.config !== null
          ? (agent.config as Record<string, unknown>)
          : {};

      // Only update agents that have no scenarioMappings configured
      const existingMappings = config["scenarioMappings"];
      if (
        existingMappings !== undefined &&
        existingMappings !== null &&
        typeof existingMappings === "object" &&
        Object.keys(existingMappings).length > 0
      ) {
        continue;
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
