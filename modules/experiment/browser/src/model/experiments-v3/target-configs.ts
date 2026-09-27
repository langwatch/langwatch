/** The workbench column a picked agent, evaluator or prompt becomes. */
import type { AgentWithFields } from "@langwatch/agent-contract";
import type { RouterOutputs } from "@langwatch/browser-trpc/workflow-api";
import type { EvaluatorTypes } from "@langwatch/evaluator-contract";
import {
  type ComparisonEvaluatorConfig,
  connectedTargetFields,
  newTargetId,
  toComparisonConfig,
} from "@langwatch/experiment-contract";
import type { FieldMapping as UIFieldMapping } from "@langwatch/prompt-browser-kit";
import { nowInstant } from "@langwatch/time";
import type { Field, HttpComponentConfig } from "@langwatch/workflow-contract";

import { convertFromUIMapping } from "./field-mapping-converters.ts";
import { buildInputsFromBodyTemplate, convertHttpComponentConfig } from "./http-agent-utils.ts";
import { type PromptOutputField, toTargetOutputFields } from "./target-output-fields.ts";
import {
  COMPARISON_EVALUATOR_TYPE,
  type EvaluationsV3State,
  type EvaluatorConfig,
  type FieldMapping,
  LEGACY_PAIRWISE_EVALUATOR_TYPE,
  type TargetConfig,
} from "./types.ts";

/** The DB evaluator's config: its type and settings; inputs come from its definition. */
type EvaluatorDbConfig = {
  evaluatorType?: EvaluatorTypes;
  settings?: Record<string, unknown>;
};

export type EvaluatorWithFields = NonNullable<RouterOutputs["evaluators"]["getById"]>;

const DEFAULT_INPUT: Field = { identifier: "input", type: "str" };
const DEFAULT_OUTPUT: Field = { identifier: "output", type: "str" };

/**
 * What an agent's own config says it reads: an HTTP agent reads its body
 * template's variables (and its HTTP config), anything else its declared inputs.
 */
const agentConfigInputs = (
  config: Record<string, unknown>,
  isHttpAgent: boolean,
): { inputs: Field[]; httpConfig?: TargetConfig["httpConfig"] } => {
  if (!isHttpAgent) {
    return { inputs: (config.inputs as TargetConfig["inputs"]) ?? [DEFAULT_INPUT] };
  }
  const httpComponentConfig = config as HttpComponentConfig;
  const inputs = buildInputsFromBodyTemplate(httpComponentConfig.bodyTemplate);
  return {
    inputs: inputs.length > 0 ? inputs : [DEFAULT_INPUT],
    httpConfig: convertHttpComponentConfig(httpComponentConfig),
  };
};

/**
 * A saved agent as a column. A connected agent reads the turn and the parameters
 * its function declares. A workflow agent's fields come from its Studio graph (the
 * API derives them); others fall back to their own config.
 */
export const savedAgentTargetConfig = (savedAgent: AgentWithFields): TargetConfig => {
  if (savedAgent.type === "connected") {
    const { inputs, outputs } = connectedTargetFields(savedAgent.config);
    return {
      id: newTargetId(),
      type: "agent",
      agentType: "connected",
      dbAgentId: savedAgent.id,
      inputs,
      outputs,
      mappings: {},
    };
  }

  const config = savedAgent.config as Record<string, unknown>;
  const isHttpAgent =
    savedAgent.type === "http" || (config.url !== undefined && config.bodyTemplate !== undefined);
  const { inputs, httpConfig } = agentConfigInputs(config, isHttpAgent);
  const { inputFields, outputFields, fieldsResolved } = savedAgent;
  const derivationIsFinal = savedAgent.type === "workflow" && fieldsResolved;

  return {
    id: newTargetId(),
    type: "agent",
    agentType: isHttpAgent ? "http" : (savedAgent.type as TargetConfig["agentType"]),
    dbAgentId: savedAgent.id,
    inputs: derivationIsFinal || inputFields.length > 0 ? inputFields : inputs,
    outputs:
      derivationIsFinal || outputFields.length > 0
        ? outputFields
        : ((config.outputs as TargetConfig["outputs"]) ?? [DEFAULT_OUTPUT]),
    mappings: {},
    httpConfig,
  };
};

/**
 * An evaluator as a column, with the API's pre-computed fields. A comparison
 * judge gets its own config (the variants and golden field it compares with),
 * seeded from any draft; its saved `has_golden_answer` decides the golden default.
 */
export const evaluatorTargetConfig = ({
  evaluator,
  pendingComparison,
}: {
  evaluator: EvaluatorWithFields;
  pendingComparison: ComparisonEvaluatorConfig | null;
}): { targetConfig: TargetConfig; needsConfiguration: boolean } => {
  const config = (evaluator.config ?? null) as {
    evaluatorType?: string;
    settings?: { has_golden_answer?: boolean };
  } | null;
  const isComparisonJudge =
    config?.evaluatorType === COMPARISON_EVALUATOR_TYPE ||
    config?.evaluatorType === LEGACY_PAIRWISE_EVALUATOR_TYPE;
  const comparison = pendingComparison ?? {
    variants: [],
    hasGoldenAnswer: config?.settings?.has_golden_answer ?? false,
    goldenField: "",
    includeMetrics: [],
    randomizeOrder: true,
  };

  const targetConfig: TargetConfig = {
    id: newTargetId(),
    type: "evaluator",
    targetEvaluatorId: evaluator.id,
    inputs: evaluator.fields.map((field) => ({
      identifier: field.identifier,
      type: field.type as Field["type"],
      ...(field.optional && { optional: true }),
    })),
    outputs: evaluator.outputFields.map((field) => ({
      identifier: field.identifier,
      type: field.type as Field["type"],
    })),
    mappings: {},
    ...(isComparisonJudge && { comparison }),
  };
  // A comparison needs two variants before it can judge anything.
  return { targetConfig, needsConfiguration: isComparisonJudge && comparison.variants.length < 2 };
};

export type PickedPrompt = {
  id: string;
  name: string;
  version?: number;
  versionId?: string;
  inputs?: { identifier: string; type: string }[];
  outputs?: PromptOutputField[];
};

/** A prompt as a column, with the inputs and outputs the prompt list already fetched. */
export const promptTargetConfig = (prompt: PickedPrompt): TargetConfig => ({
  id: newTargetId(),
  type: "prompt",
  promptId: prompt.id,
  promptVersionId: prompt.versionId,
  promptVersionNumber: prompt.version,
  inputs: (prompt.inputs ?? [DEFAULT_INPUT]).map((i) => ({
    identifier: i.identifier,
    type: i.type as Field["type"],
  })),
  outputs: toTargetOutputFields(prompt.outputs ?? [DEFAULT_OUTPUT]),
  mappings: {},
});

export type SavedPrompt = {
  id: string;
  versionId: string;
  version: number;
  inputs?: { identifier: string; type: string }[];
  outputs?: { identifier: string; type: string }[];
};

/**
 * A prompt created in the add-target flow, as a column carrying the mappings the
 * reader made before it existed, on the dataset active when it was saved.
 */
export const savedPromptTargetConfig = ({
  savedPrompt,
  pendingMappings,
  isDatasetSource,
  activeDatasetId,
}: {
  savedPrompt: SavedPrompt;
  pendingMappings: Record<string, UIFieldMapping>;
  isDatasetSource: (sourceId: string) => boolean;
  activeDatasetId: string;
}): TargetConfig => {
  const storeMappings: Record<string, FieldMapping> = Object.fromEntries(
    Object.entries(pendingMappings).map(([key, uiMapping]) => [
      key,
      convertFromUIMapping(uiMapping, isDatasetSource),
    ]),
  );
  return {
    ...promptTargetConfig({
      id: savedPrompt.id,
      name: "",
      version: savedPrompt.version,
      versionId: savedPrompt.versionId,
      inputs: savedPrompt.inputs,
      outputs: savedPrompt.outputs,
    }),
    mappings: Object.keys(storeMappings).length > 0 ? { [activeDatasetId]: storeMappings } : {},
  };
};

/**
 * An evaluator picked for the workbench. Its settings are never stored here;
 * they are always read fresh from the database.
 */
export const workbenchEvaluatorConfig = (evaluator: EvaluatorWithFields): EvaluatorConfig => {
  const config = evaluator.config as EvaluatorDbConfig | null;
  return {
    id: `evaluator_${nowInstant().epochMilliseconds}`,
    evaluatorType: (config?.evaluatorType ?? "custom/unknown") as EvaluatorConfig["evaluatorType"],
    inputs: evaluator.fields.map((field) => ({
      identifier: field.identifier,
      type: field.type as Field["type"],
      ...(field.optional && { optional: true }),
    })),
    mappings: {},
    dbEvaluatorId: evaluator.id,
  };
};

/**
 * What the Comparison flow hands the evaluator editor so the creation form shows
 * the variant picker and golden field straight away (#5195).
 */
export const comparisonContextOf = (state: EvaluationsV3State) => {
  const activeDataset = state.datasets.find((d) => d.id === state.activeDatasetId);
  return {
    targets: state.targets.filter((t) => t.type !== "evaluator"),
    datasetColumns: activeDataset?.columns.map((c) => ({ id: c.id, name: c.name })) ?? [],
    datasetName: activeDataset?.name,
  };
};

/**
 * The comparison editor's context after a full page reload. An edit carries the
 * DB evaluator id, so its saved comparison is re-derived; a fresh "New Comparison"
 * has no id and starts blank (its draft was never persisted).
 */
export const reloadedComparisonContext = ({
  state,
  evaluatorId,
}: {
  state: EvaluationsV3State;
  evaluatorId: string | undefined;
}) => {
  const evaluatorMatch = evaluatorId
    ? state.evaluators.find((e) => e.dbEvaluatorId === evaluatorId)
    : undefined;
  const targetMatch = evaluatorId
    ? state.targets.find((t) => t.targetEvaluatorId === evaluatorId)
    : undefined;
  const comparisonSource = evaluatorMatch ?? targetMatch;
  const initialComparison = comparisonSource ? toComparisonConfig(comparisonSource) : undefined;
  return {
    targetMatch,
    comparisonContext: {
      ...(initialComparison ? { initialComparison } : {}),
      ...comparisonContextOf(state),
    },
  };
};
