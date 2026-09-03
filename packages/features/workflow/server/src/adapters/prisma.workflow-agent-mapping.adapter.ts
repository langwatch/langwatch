/**
 * The scenario mappings a saved Studio graph refreshes on the agents that run
 * it.
 *
 * Moved whole from the platform app's
 * `server/workflows/auto-compute-agent-mappings.ts`: the extraction, the
 * blank-template skip, the preserve-then-fill merge and the independent
 * output-field repair are unchanged, because each of them is a decision about
 * a customer's configured mapping and getting any of them wrong silently
 * rewrites work somebody did by hand.
 *
 * Two things changed on the way, and only two: the loose `@xyflow/react`
 * `Node`/`Edge` aliases became the Studio node and edge types the mapping
 * helper already takes, and the failure is reported through an injected
 * logger rather than `console.error`.
 *
 * It stays best-effort. A refresh that fails must never fail the version that
 * was already written — the graph is saved either way, and an agent whose
 * mappings did not refresh is a stale default rather than lost work.
 */
import { computeBestMatchMappings } from "@langwatch/scenario-contract";
import {
  getMappingSurfaceInputs,
  type StudioEdge,
  type StudioNode,
  type StudioWorkflow,
} from "@langwatch/workflow-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import { WorkflowAgentMappingPort } from "../ports/workflow.port";

/** The agent rows this adapter reads and writes, named structurally. */
export type WorkflowAgentMappingDatabase = {
  agent: {
    findMany(args: unknown): Promise<Array<{ id: string; config: unknown }>>;
    update(args: unknown): Promise<unknown>;
  };
};

/** The graph shape the extraction needs, and nothing more. */
type MappingSurfaceGraph = { nodes: StudioNode[]; edges: StudioEdge[] };

/**
 * The entry output and end input the blank template ships with.
 *
 * While the graph still carries exactly these, the person has not designed
 * anything yet and auto-computing a mapping would only pin a placeholder.
 */
const BLANK_TEMPLATE_INPUT = "question";
const BLANK_TEMPLATE_OUTPUT = "output";

type Identified = { identifier: string };

/**
 * The normalised inputs and outputs of a graph.
 *
 * Inputs come from `getMappingSurfaceInputs`, which includes declared entry
 * outputs whether or not they have downstream edges. Outputs come from the end
 * node's declared inputs directly. This is the client-side `extractVariables`
 * rule, restated server-side so nothing here reaches a browser-only module.
 */
function extractVariablesFromGraph(dsl: MappingSurfaceGraph): {
  inputs: Identified[];
  outputs: Identified[];
} {
  const inputs = getMappingSurfaceInputs(dsl.edges, dsl.nodes).flatMap((field): Identified[] =>
    typeof field.identifier === "string" ? [{ identifier: field.identifier }] : [],
  );

  const endNodeData = dsl.nodes.find((node) => node.type === "end" || node.id === "end")?.data;
  const rawOutputs: unknown[] = Array.isArray(
    (endNodeData as { inputs?: unknown } | undefined)?.inputs,
  )
    ? (endNodeData as { inputs: unknown[] }).inputs
    : [];

  const outputs = rawOutputs.flatMap((entry: unknown): Identified[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const field = entry as { identifier?: unknown };
    return typeof field.identifier === "string" ? [{ identifier: field.identifier }] : [];
  });

  return { inputs, outputs };
}

/** Whether the graph still matches the blank template's placeholders exactly. */
function isBlankTemplateGraph(input: { inputs: Identified[]; outputs: Identified[] }): boolean {
  return (
    input.inputs.length === 1 &&
    input.inputs[0]?.identifier === BLANK_TEMPLATE_INPUT &&
    input.outputs.length === 1 &&
    input.outputs[0]?.identifier === BLANK_TEMPLATE_OUTPUT
  );
}

/** Recomputes and persists the scenario mappings of a workflow's agents. */
export class PrismaWorkflowAgentMappingAdapter extends WorkflowAgentMappingPort {
  static create(options: {
    database: WorkflowAgentMappingDatabase;
    logger?: Pick<Logger, "error">;
  }): PrismaWorkflowAgentMappingAdapter {
    return new PrismaWorkflowAgentMappingAdapter(options);
  }

  private constructor(
    private readonly options: {
      database: WorkflowAgentMappingDatabase;
      logger?: Pick<Logger, "error">;
    },
  ) {
    super();
  }

  private readonly fallbackLogger: Pick<Logger, "error"> = createLogger(
    "langwatch:workflow:agent-mappings",
  );

  async recompute(input: {
    projectId: string;
    workflowId: string;
    dsl: StudioWorkflow;
  }): Promise<void> {
    try {
      const agents = await this.options.database.agent.findMany({
        where: {
          workflowId: input.workflowId,
          projectId: input.projectId,
          archivedAt: null,
        },
        select: { id: true, config: true },
      });

      if (agents.length === 0) return;

      const graph = input.dsl as unknown as MappingSurfaceGraph;
      const { inputs, outputs } = extractVariablesFromGraph(graph);

      if (isBlankTemplateGraph({ inputs, outputs })) return;

      const mappings = computeBestMatchMappings({ inputs });
      const scenarioOutputField =
        outputs[0]?.identifier !== undefined ? outputs[0].identifier : undefined;

      const inputIdentifiers = new Set(inputs.map((field) => field.identifier));
      const outputIdentifiers = new Set(outputs.map((field) => field.identifier));

      for (const agent of agents) {
        const config =
          typeof agent.config === "object" && agent.config !== null
            ? (agent.config as Record<string, unknown>)
            : {};

        const existingMappings = config.scenarioMappings;
        const currentMappings =
          existingMappings !== null &&
          typeof existingMappings === "object" &&
          !Array.isArray(existingMappings)
            ? (existingMappings as Record<string, unknown>)
            : {};
        const hasExistingMappings = Object.keys(currentMappings).length > 0;

        // Mappings whose keys are still valid workflow inputs are preserved;
        // stale ones are dropped.
        const preservedMappings = Object.fromEntries(
          Object.entries(currentMappings).filter(([key]) => inputIdentifiers.has(key)),
        );

        // Auto-computed best matches fill only the inputs the person has not
        // already mapped, so one input going stale never clobbers the rest.
        const nextMappings: Record<string, unknown> = {
          ...mappings,
          ...preservedMappings,
        };

        // "Changed" means the key SET differs. `preservedMappings` is a subset
        // of `currentMappings` with identical entries, so key-set difference is
        // the whole of it.
        const currentKeys = Object.keys(currentMappings);
        const nextKeys = Object.keys(nextMappings);
        const mappingsChanged =
          hasExistingMappings &&
          (currentKeys.length !== nextKeys.length ||
            currentKeys.some((key) => !(key in nextMappings)));
        const needsInitialMappings = !hasExistingMappings && Object.keys(nextMappings).length > 0;

        // Output-field staleness is evaluated independently of the input
        // mappings. It is repaired only when the stored value names a field
        // that no longer exists, and initialised only on the first
        // auto-compute — an intentionally unset field on a configured agent is
        // left alone.
        const existingOutputField = config.scenarioOutputField;
        const outputFieldIsStale =
          typeof existingOutputField === "string" && !outputIdentifiers.has(existingOutputField);
        const shouldUpdateOutputField =
          scenarioOutputField !== undefined &&
          (outputFieldIsStale || (!hasExistingMappings && existingOutputField === undefined));
        // A stale stored field with no replacement is stripped, so the adapter
        // does not read a non-existent identifier at run time.
        const shouldRemoveOutputField = outputFieldIsStale && scenarioOutputField === undefined;

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
              Object.entries(config).filter(([key]) => key !== "scenarioOutputField"),
            )
          : config;

        const updatedConfig: Record<string, unknown> = {
          ...baseConfig,
          ...(mappingsChanged || needsInitialMappings ? { scenarioMappings: nextMappings } : {}),
          ...(shouldUpdateOutputField ? { scenarioOutputField } : {}),
        };

        await this.options.database.agent.update({
          where: { id: agent.id, projectId: input.projectId },
          data: { config: updatedConfig },
        });
      }
    } catch (error) {
      (this.options.logger ?? this.fallbackLogger).error(
        { error, projectId: input.projectId, workflowId: input.workflowId },
        "failed to auto-compute agent scenario mappings",
      );
    }
  }
}
