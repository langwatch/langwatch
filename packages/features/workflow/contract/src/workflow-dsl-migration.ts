import { z } from "zod";

import type { WorkflowDsl } from "./workflow";
import {
  parseStudioWorkflow,
  type StudioWorkflow,
} from "./studio-workflow";

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
type MigrationParameter = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parametersOf = (node: MigrationNode): MigrationParameter[] | undefined => {
  const { parameters } = node.data;
  return Array.isArray(parameters) && parameters.every(isRecord)
    ? parameters
    : undefined;
};

const updateParameters = (
  node: MigrationNode,
  transform: (parameter: MigrationParameter) => MigrationParameter,
) => {
  const parameters = parametersOf(node);
  if (parameters) {
    node.data.parameters = parameters.map(transform);
  }
};

/** Migrate persisted DSL, then validate it at the canonical Studio boundary. */
export const migrateDSLVersion = (dsl: WorkflowDsl): StudioWorkflow => {
  const migrating = migrationDslSchema.parse(JSON.parse(JSON.stringify(dsl)));

  if (migrating.spec_version === "1.0") {
    migrating.spec_version = "1.1";
    migrating.nodes.forEach((node) => {
      if (node.type !== "entry") return;
      const split = node.data.train_test_split;
      const testSize = typeof split === "number" ? split : 0.2;
      node.data.test_size = testSize;
      delete node.data.train_test_split;
      node.data.train_size = 1 - testSize;
    });
  }

  if (migrating.spec_version === "1.1") {
    migrating.spec_version = "1.2";
    migrating.nodes.forEach((node) => {
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
    });
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
    const defaultLlm = migrating.default_llm;
    if (
      isRecord(defaultLlm) &&
      typeof defaultLlm.model === "string" &&
      defaultLlm.model !== ""
    ) {
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
    }
    delete migrating.default_llm;
  }

  return parseStudioWorkflow(migrating);
};
