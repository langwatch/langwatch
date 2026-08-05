import { HandledError } from "@langwatch/handled-error";
import type { DatasetReference, TargetConfig } from "~/experiments-v3/types";
import { AgentNotFoundError } from "~/server/agents/errors";

/**
 * The doubles and builders the comparison suites share.
 *
 * Both suites drive `attachComparison`, one for how variants resolve into
 * targets and one for how the comparison's own config is validated, so the
 * experiment shape and the service doubles are genuinely common ground rather
 * than something split out to make a file shorter.
 */

/**
 * The handled error `work` rejected with, for a test to assert on. Tests assert
 * the `code` rather than the sentence: the code is the contract every caller
 * branches on, the sentence is copy.
 */
export const rejectionOf = async (
  work: Promise<unknown>,
): Promise<HandledError> => {
  const error: unknown = await work.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  if (!HandledError.isHandled(error)) {
    throw new Error(`expected a handled error, got: ${String(error)}`);
  }
  return error;
};

export const dataset = (): DatasetReference => ({
  id: "dataset-1",
  name: "Test Dataset",
  type: "inline",
  columns: [
    { id: "input", name: "input", type: "string" },
    { id: "expected_output", name: "expected_output", type: "string" },
  ],
});

export const promptTarget = (id: string): TargetConfig => ({
  id,
  type: "prompt",
  promptId: `prompt-${id}`,
  inputs: [{ identifier: "input", type: "str" }],
  outputs: [{ identifier: "output", type: "str" }],
  mappings: {
    "dataset-1": {
      input: {
        type: "source",
        source: "dataset",
        sourceId: "dataset-1",
        sourceField: "input",
      },
    },
  },
});

export const fakePromptService = (
  prompts: Record<string, { id: string; version: number; versionId: string }>,
) => ({
  getPromptByIdOrHandle: async ({ idOrHandle }: { idOrHandle: string }) => {
    const found = prompts[idOrHandle];
    if (!found) return null;
    return {
      ...found,
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
    } as never;
  },
});

export const fakeAgentService = (
  agents: Record<string, { id: string; type: string; config: unknown }>,
) => ({
  getByIdOrThrow: async ({ id }: { id: string }) => {
    const found = agents[id];
    if (!found) throw new AgentNotFoundError();
    return found as never;
  },
});

export const fakeEvaluatorService = () => {
  let created: { id: string; config: unknown } | undefined;
  return {
    getAllWithFields: async () =>
      created
        ? [
            {
              ...created,
              fields: [{ identifier: "candidates", type: "str" }],
              outputFields: [{ identifier: "label", type: "str" }],
            } as never,
          ]
        : [],
    createWithDefaults: async (input: { id: string; config: unknown }) => {
      created = { id: input.id, config: input.config };
      return created as never;
    },
    enrichWithFields: async (evaluator: { id: string; config: unknown }) =>
      ({
        ...evaluator,
        fields: [{ identifier: "candidates", type: "str" }],
        outputFields: [{ identifier: "label", type: "str" }],
      }) as never,
  };
};
