import type {
  LLMConfig,
  LlmPromptConfigComponent,
} from "~/optimization_studio/types/dsl";

export function setDefaultLlmConfigToParameters(
  parameters: LlmPromptConfigComponent["parameters"],
  defaultLLMConfig: LLMConfig,
) {
  return parameters.map((item) => {
    if (item.identifier === "llm") {
      const value =
        typeof item.value === "object" ? item.value : defaultLLMConfig;

      return {
        ...item,
        value,
      };
    }

    return item;
  }) as LlmPromptConfigComponent["parameters"];
}
