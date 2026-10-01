import { allLitellmModels } from "@langwatch/model-provider-contract";
import type React from "react";

import { modelProviderIcons } from "../provider-icons.ts";

export type ModelOption = {
  label: string;
  value: string;
  icon: React.ReactNode;
  isDisabled: boolean;
  mode?: "chat" | "embedding" | undefined;
  isCustom?: boolean;
};

export const modelSelectorOptions: ModelOption[] = Object.entries(allLitellmModels).map(
  ([key, value]) => ({
    label: key,
    value: key,
    icon: modelProviderIcons[key.split("/")[0] as keyof typeof modelProviderIcons],
    isDisabled: false,
    mode: value.mode as "chat" | "embedding",
  }),
);

export const allModelOptions = modelSelectorOptions.map((option) => option.value);
