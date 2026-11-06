import { findAliasTarget, isLatestAlias } from "./catalog/latest-aliases.ts";
import { allLitellmModels } from "./catalog/model-catalog.ts";
import { modelDisplayLabel } from "./model-provider-display-names.ts";

export type ModelOption = {
  label: string;
  value: string;
  isDisabled: boolean;
  mode?: "chat" | "embedding" | undefined;
  isCustom?: boolean;
  /** Served by LangWatch's own offer, so no provider row of the project's has to carry it. */
  isBuiltIn?: boolean;
  /** One line under the title: what a decision model is, from its catalogue entry. */
  subtitle?: string;
};

export const modelSelectorOptions: ModelOption[] = Object.entries(allLitellmModels).map(
  ([key, value]) => ({
    label: key,
    value: key,
    isDisabled: false,
    mode: value.mode as "chat" | "embedding",
  }),
);

export const allModelOptions = modelSelectorOptions.map((option) => option.value);

/** One entry of a model picker: what it says and what it picks, before any icon is drawn. */
export type ModelPickerOption = {
  label: string;
  value: string;
  /** Under the label: what an alias resolves to, or what a decision model is. */
  subtitle?: string;
  /** Listed but not pickable: a decision model whose provider has no key yet. */
  disabled?: boolean;
  /** A short tag beside the title, such as "Coming soon". */
  hint?: string;
};

/**
 * Alias entries (`<provider>/latest`, `<provider>/latest-mini`) read as
 * "Latest" / "Latest smaller model" with the resolved id as a subtitle, so
 * the picker shows what the pick would actually get.
 */
export function modelPickerOption({
  displayNames,
  modelValue,
}: {
  displayNames: Record<string, string> | undefined;
  modelValue: string;
}): ModelPickerOption {
  if (!isLatestAlias(modelValue)) {
    return {
      label: modelDisplayLabel({ fullModelId: modelValue, displayNames }),
      value: modelValue,
      subtitle: "",
    };
  }
  const suffix = modelValue.split("/")[1] ?? "";
  return {
    label: suffix === "latest" ? "Latest" : "Latest smaller model",
    value: modelValue,
    subtitle: findAliasTarget(modelValue)[0] ?? "",
  };
}
