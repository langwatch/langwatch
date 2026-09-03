import { createLogger } from "@langwatch/observability";
import {
  getInputsOutputs,
  normalizeWorkflowLlmParameters,
  studioWorkflowSchema,
} from "@langwatch/workflow-contract";
import { z } from "zod";

import {
  type ModelParamsFailureReason,
  ScenarioModelParametersService,
} from "./scenario-model-parameters.service";

const logger = createLogger("langwatch:scenarios:workflow-execution");

const llmValueSchema = z.looseObject({ model: z.string().min(1).optional() });
const workflowParameterSchema = z.looseObject({
  type: z.string(),
  value: llmValueSchema.optional(),
});
const workflowNodeSchema = z.looseObject({
  data: z.looseObject({ parameters: z.array(z.unknown()).optional() }),
});
const workflowNodesSchema = z.array(z.unknown());
const specVersionSchema = z.union([z.string(), z.number()]);

interface WorkflowField {
  identifier: string;
  type: string;
}

type HydrateLlmResult =
  | { success: true; dsl: Record<string, unknown> }
  | { success: false; reason: ModelParamsFailureReason; message: string };

function defaultModelForDsl(
  dsl: Record<string, unknown>,
  legacyDefaultModel: string,
): { defaultLlm: Record<string, unknown> | null; defaultModel?: string } {
  const parsedVersion = specVersionSchema.safeParse(dsl.spec_version);
  const specParts = parsedVersion.success
    ? String(parsedVersion.data).split(".").map(Number)
    : [];
  const specMajor = specParts[0] ?? Number.NaN;
  const specMinor = specParts[1] ?? 0;
  const legacy =
    !Number.isFinite(specMajor) ||
    !Number.isFinite(specMinor) ||
    specMajor < 1 ||
    (specMajor === 1 && specMinor < 5);
  if (!legacy) {
    return { defaultLlm: null };
  }

  const parsedDefault = llmValueSchema.safeParse(dsl.default_llm);
  const defaultLlm = parsedDefault.success ? parsedDefault.data : null;
  return {
    defaultLlm,
    defaultModel: defaultLlm?.model ?? legacyDefaultModel,
  };
}

function parameterModel(value: unknown, defaultModel?: string): string | undefined {
  const parsed = workflowParameterSchema.safeParse(value);
  if (!parsed.success || parsed.data.type !== "llm") {
    return void 0;
  }
  return parsed.data.value?.model ?? defaultModel;
}

export class ScenarioWorkflowHydratorService {
  static create(
    modelParameters: ScenarioModelParametersService,
  ): ScenarioWorkflowHydratorService {
    return new ScenarioWorkflowHydratorService(modelParameters);
  }

  private constructor(private readonly modelParameters: ScenarioModelParametersService) {}

  async hydrate({
    dsl,
    projectId,
    legacyDefaultModel,
  }: {
    dsl: Record<string, unknown>;
    projectId: string;
    legacyDefaultModel: string;
  }): Promise<HydrateLlmResult> {
    const parsedNodes = workflowNodesSchema.safeParse(dsl.nodes);
    const nodes = parsedNodes.success ? parsedNodes.data : [];
    if (nodes.length === 0) {
      return { success: true, dsl };
    }

    const { defaultLlm, defaultModel } = defaultModelForDsl(dsl, legacyDefaultModel);
    const modelsNeeded = new Set<string>();

    for (const node of nodes) {
      const parsedNode = workflowNodeSchema.safeParse(node);
      if (!parsedNode.success) {
        continue;
      }

      for (const parameter of parsedNode.data.data.parameters ?? []) {
        const model = parameterModel(parameter, defaultModel);
        if (model) {
          modelsNeeded.add(model);
        }
      }
    }

    if (modelsNeeded.size === 0) {
      return { success: true, dsl };
    }

    const litellmParamsByModel = new Map<string, Record<string, unknown>>();
    const prepared = await Promise.all(
      [...modelsNeeded].map(async (model) => ({
        model,
        result: await this.modelParameters.prepare({ projectId, model }),
      })),
    );

    for (const { model, result } of prepared) {
      if (!result.success) {
        logger.warn(
          { projectId, model, reason: result.reason },
          `Failed to hydrate llm parameter: ${result.message}`,
        );
        return { success: false, reason: result.reason, message: result.message };
      }

      litellmParamsByModel.set(model, z.looseObject({}).parse(result.params));
    }

    const hydratedNodes = this.hydrateNodes({
      nodes,
      defaultLlm,
      defaultModel,
      litellmParamsByModel,
    });

    return { success: true, dsl: { ...dsl, nodes: hydratedNodes } };
  }

  private hydrateNodes(input: {
    nodes: unknown[];
    defaultLlm: Record<string, unknown> | null;
    defaultModel: string | undefined;
    litellmParamsByModel: Map<string, Record<string, unknown>>;
  }): unknown[] {
    return input.nodes.map((node) => {
      const parsedNode = workflowNodeSchema.safeParse(node);
      if (!parsedNode.success || !parsedNode.data.data.parameters) {
        return node;
      }

      const parameters = parsedNode.data.data.parameters.map((parameter) => {
        const parsedParameter = workflowParameterSchema.safeParse(parameter);
        if (!parsedParameter.success || parsedParameter.data.type !== "llm") {
          return parameter;
        }

        const model = parsedParameter.data.value?.model ?? input.defaultModel;
        const litellmParams = model ? input.litellmParamsByModel.get(model) : void 0;
        if (!model || !litellmParams) {
          return parameter;
        }

        const base = parsedParameter.data.value ?? input.defaultLlm ?? { model };
        return {
          ...parsedParameter.data,
          value: {
            ...normalizeWorkflowLlmParameters(base),
            model,
            litellm_params: litellmParams,
          },
        };
      });

      return {
        ...parsedNode.data,
        data: { ...parsedNode.data.data, parameters },
      };
    });
  }

  extractWorkflowIO(dsl: Record<string, unknown>): {
    inputs: WorkflowField[];
    outputs: WorkflowField[];
  } {
    const rawNodes = z.array(z.looseObject({})).safeParse(dsl.nodes);
    const nodes = rawNodes.success
      ? rawNodes.data.map((node) => ({
          ...node,
          position: node.position ?? { x: 0, y: 0 },
        }))
      : [];
    const parsed = studioWorkflowSchema.safeParse({
      name: "Scenario workflow",
      icon: "",
      description: "",
      state: { execution: { status: "idle" } },
      ...dsl,
      spec_version: String(dsl.spec_version ?? "1.5"),
      version: String(dsl.version ?? "1.0"),
      nodes,
    });
    if (!parsed.success) {
      return { inputs: [], outputs: [] };
    }

    const { inputs: rawInputs, outputs: rawOutputs } = getInputsOutputs(
      parsed.data.edges,
      parsed.data.nodes,
    );
    const inputs = rawInputs.flatMap((input) =>
      input.identifier ? [{ identifier: input.identifier, type: "str" }] : [],
    );
    const outputs = (rawOutputs ?? []).map((output) => ({
      identifier: output.identifier,
      type: output.type,
    }));

    return { inputs, outputs };
  }
}
