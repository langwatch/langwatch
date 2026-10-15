import { z } from "zod";

import { parseStudioWorkflow, type StudioWorkflow } from "./studio-workflow.ts";
import type { WorkflowDsl } from "./workflow.ts";

const migrationNodeSchema = z
  .object({
    id: z.string(),
    type: z.string().optional(),
    data: z.record(z.string(), z.unknown()),
  })
  .passthrough();

const migrationDslSchema = z
  .object({
    spec_version: z.string().optional(),
    nodes: z.array(migrationNodeSchema),
    default_llm: z.unknown().optional(),
  })
  .passthrough();

type MigrationNode = z.infer<typeof migrationNodeSchema>;
type MigrationDsl = z.infer<typeof migrationDslSchema>;
type MigrationParameter = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const extractParameters = (node: MigrationNode): MigrationParameter[] | undefined => {
  const { parameters } = node.data;
  return Array.isArray(parameters) && parameters.every(isRecord) ? parameters : undefined;
};

const updateParameters = (
  node: MigrationNode,
  transform: (parameter: MigrationParameter) => MigrationParameter,
) => {
  const parameters = extractParameters(node);
  if (parameters) {
    node.data.parameters = parameters.map(transform);
  }
};

/** 1.0 → 1.1: the entry node's single split becomes explicit train and test sizes. */
const splitEntryTrainTest = (node: MigrationNode) => {
  if (node.type !== "entry") return;
  const split = node.data.train_test_split;
  const testSize = typeof split === "number" ? split : 0.2;
  node.data.test_size = testSize;
  delete node.data.train_test_split;
  node.data.train_size = 1 - testSize;
};

/** 1.1 → 1.2: parameters carry a value, and signature fields become parameters. */
const parameteriseNode = (node: MigrationNode) => {
  updateParameters(node, (parameter) => ({
    ...parameter,
    value: parameter.defaultValue ?? undefined,
  }));
  if (node.type !== "signature") return;
  node.data.parameters = [
    { identifier: "llm", type: "llm", value: node.data.llm },
    {
      identifier: "prompting_technique",
      type: "prompting_technique",
      value: node.data.decorated_by,
    },
    { identifier: "instructions", type: "str", value: node.data.prompt },
    {
      identifier: "demonstrations",
      type: "dataset",
      value: node.data.demonstrations,
    },
  ];
  delete node.data.llm;
  delete node.data.decorated_by;
  delete node.data.prompt;
  delete node.data.demonstrations;
};

/** 1.4 → 1.5: the workflow-wide default model moves onto every modelless llm parameter. */
const foldDefaultLlmIntoNodes = (migrating: MigrationDsl) => {
  const defaultLlm = migrating.default_llm;
  if (!isRecord(defaultLlm) || typeof defaultLlm.model !== "string" || defaultLlm.model === "") {
    return;
  }
  migrating.nodes.forEach((node) => {
    updateParameters(node, (parameter) => {
      if (parameter.type !== "llm") return parameter;
      const value = parameter.value;
      if (isRecord(value) && value.model) return parameter;
      return {
        ...parameter,
        value: {
          ...defaultLlm,
          ...(isRecord(value) ? value : {}),
          model: defaultLlm.model,
        },
      };
    });
  });
};

/** Migrate persisted DSL, then validate it at the canonical Studio boundary. */
export const migrateDSLVersion = (dsl: WorkflowDsl): StudioWorkflow => {
  const migrating = migrationDslSchema.parse(JSON.parse(JSON.stringify(dsl)));

  if (migrating.spec_version === "1.0") {
    migrating.spec_version = "1.1";
    migrating.nodes.forEach(splitEntryTrainTest);
  }

  if (migrating.spec_version === "1.1") {
    migrating.spec_version = "1.2";
    migrating.nodes.forEach(parameteriseNode);
  }

  if (migrating.spec_version === "1.2") {
    migrating.spec_version = "1.3";
    migrating.enable_tracing = true;
  }

  if (migrating.spec_version === "1.3") {
    migrating.spec_version = "1.4";
    migrating.template_adapter = "dspy_chat_adapter";
  }

  if (migrating.spec_version === "1.4") {
    migrating.spec_version = "1.5";
    foldDefaultLlmIntoNodes(migrating);
    delete migrating.default_llm;
  }

  return parseStudioWorkflow(migrating);
};
