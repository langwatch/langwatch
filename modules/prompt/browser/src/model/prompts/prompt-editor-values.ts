import type { LocalPromptConfig } from "@langwatch/experiment-contract";
import { getFieldsUsedByPromptTemplate } from "@langwatch/experiment-contract/mapping-validation";
import type { PromptConfigFormValues } from "@langwatch/prompt-contract";
import type { AvailableSource, FieldMapping } from "@langwatch/workflow-contract";

import { areFormValuesEqual } from "../../prompt-form.ts";
import type { LlmConfigInputType } from "../workflow/types.ts";

/** The unpublished changes an editor persists, read from its form values. */
export const extractLocalConfig = (formValues: PromptConfigFormValues): LocalPromptConfig => ({
  llm: {
    model: formValues.version.configData.llm.model,
    temperature: formValues.version.configData.llm.temperature,
    maxTokens: formValues.version.configData.llm.maxTokens,
    topP: formValues.version.configData.llm.topP,
    frequencyPenalty: formValues.version.configData.llm.frequencyPenalty,
    presencePenalty: formValues.version.configData.llm.presencePenalty,
    seed: formValues.version.configData.llm.seed,
    topK: formValues.version.configData.llm.topK,
    minP: formValues.version.configData.llm.minP,
    repetitionPenalty: formValues.version.configData.llm.repetitionPenalty,
    reasoning: formValues.version.configData.llm.reasoning,
    verbosity: formValues.version.configData.llm.verbosity,
    litellmParams: formValues.version.configData.llm.litellmParams,
  },
  messages: formValues.version.configData.messages.map((m) => ({
    role: m.role,
    content: m.content,
  })),
  inputs: formValues.version.configData.inputs.map((i) => ({
    identifier: i.identifier,
    type: i.type,
  })) as LocalPromptConfig["inputs"],
  outputs: formValues.version.configData.outputs.map((o) => ({
    identifier: o.identifier,
    type: o.type,
    json_schema: o.json_schema,
  })) as LocalPromptConfig["outputs"],
});

type ConfigData = PromptConfigFormValues["version"]["configData"];

/** Unpublished edits laid over the stored prompt; the local lists replace the stored ones. */
export function mergeLocalOverServer({
  serverValues,
  local,
}: {
  serverValues: PromptConfigFormValues;
  local: LocalPromptConfig | undefined;
}): PromptConfigFormValues {
  if (!local) return serverValues;
  return {
    ...serverValues,
    version: {
      ...serverValues.version,
      configData: {
        ...serverValues.version.configData,
        llm: { ...serverValues.version.configData.llm, ...local.llm },
        messages: local.messages,
        inputs: local.inputs as ConfigData["inputs"],
        outputs: local.outputs as ConfigData["outputs"],
      },
    },
  };
}

/** A non-empty list from the saved config, else the default one. */
const unlessEmpty = <Item>(saved: readonly unknown[], fallback: Item[]): Item[] =>
  saved.length > 0 ? (saved as Item[]) : fallback;

/** A node's saved config laid over the new-prompt defaults, keeping defaults for empty lists. */
export function mergeConfigOverDefaults({
  defaults,
  config,
}: {
  defaults: PromptConfigFormValues;
  config: LocalPromptConfig | undefined;
}): PromptConfigFormValues {
  if (!config) return defaults;
  const base = defaults.version.configData;
  return {
    ...defaults,
    version: {
      ...defaults.version,
      configData: {
        ...base,
        llm: { ...base.llm, ...config.llm },
        messages: unlessEmpty(config.messages, base.messages),
        inputs: unlessEmpty(config.inputs, base.inputs),
        outputs: unlessEmpty(config.outputs, base.outputs),
      },
    },
  };
}

/** Each default input matched to a source field of the same name, case-insensitively. */
export function autoMappingsFor({
  inputs,
  availableSources,
}: {
  inputs: readonly { identifier: string }[];
  availableSources: readonly AvailableSource[];
}): { identifier: string; mapping: FieldMapping }[] {
  const allFields = availableSources.flatMap((source) =>
    source.fields.map((f) => ({ ...f, sourceId: source.id })),
  );
  return inputs.flatMap((input) => {
    const match = allFields.find((f) => f.name.toLowerCase() === input.identifier.toLowerCase());
    if (!match) return [];
    const mapping: FieldMapping = { type: "source", sourceId: match.sourceId, path: [match.name] };
    return [{ identifier: input.identifier, mapping }];
  });
}

/** A source field's type as a prompt input type; lists and unknown types read as text. */
const INPUT_TYPE_BY_FIELD_TYPE: Record<string, LlmConfigInputType> = {
  string: "str",
  str: "str",
  number: "float",
  float: "float",
  int: "float",
  boolean: "bool",
  bool: "bool",
  image: "image",
  file: "file",
  dict: "dict",
  list: "str",
};

export const inputTypeForField = (fieldType: string): LlmConfigInputType =>
  INPUT_TYPE_BY_FIELD_TYPE[fieldType] ?? "str";

/**
 * Variables the template consumes and the inputs declare but nothing maps. The
 * workbench column header uses the same rule, so both name the same variables.
 * Outside a mapping context (no sources) nothing is missing.
 */
export function missingMappingIdsFor({
  messages,
  inputs,
  inputMappings,
  availableSources,
}: {
  messages: readonly ({ role?: string; content?: string } | undefined)[];
  inputs: readonly { identifier: string }[];
  inputMappings: Record<string, FieldMapping> | undefined;
  availableSources: readonly AvailableSource[] | undefined;
}): Set<string> {
  if (!availableSources || availableSources.length === 0) return new Set<string>();

  const declaredFieldIds = inputs.map((input) => input.identifier);
  const usedVariables = getFieldsUsedByPromptTemplate({
    messages: messages.map((message) => ({
      role: message?.role ?? "user",
      content: message?.content ?? "",
    })),
    declaredFieldIds,
  });

  const declared = new Set(declaredFieldIds);
  return new Set([...usedVariables].filter((id) => declared.has(id) && !inputMappings?.[id]));
}

/** A new prompt is unsaved once any message has content; a stored one when it differs. */
export function isUnsavedFormValues({
  formValues,
  isNewPrompt,
  saved,
}: {
  formValues: PromptConfigFormValues;
  isNewPrompt: boolean;
  saved: PromptConfigFormValues | undefined;
}): boolean {
  if (isNewPrompt) {
    const messages = formValues.version?.configData?.messages ?? [];
    return messages.some((m) => m?.content?.trim());
  }
  return saved ? !areFormValuesEqual(formValues, saved) : false;
}
