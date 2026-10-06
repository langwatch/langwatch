/** The model display and picker model-provider lends the screens that choose one (§10, §10.1). */

import { uiTokens } from "@langwatch/module";

/** What a screen hands model-provider's display of one chosen model. */
export type ModelDisplayProps = {
  model: string;
  fontSize?: string;
};

/** What a screen hands model-provider's model picker. */
export type ModelSelectorProps = {
  model: string;
  options: string[];
  onChange: (model: string) => void;
  size?: "sm" | "md" | "full";
  mode?: "chat" | "embedding";
  /** A "Configure available models" link at the bottom of the dropdown. */
  showConfigureAction?: boolean;
  /** Names the feature in the callout shown when no model is available. */
  forFeatureLabel?: string;
};

export const ModelDisplayToken =
  uiTokens("model-provider").component<ModelDisplayProps>("modelDisplay");
export const ModelSelectorToken =
  uiTokens("model-provider").component<ModelSelectorProps>("modelSelector");
