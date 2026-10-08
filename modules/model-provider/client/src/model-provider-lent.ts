/** Model-provider UI lent by token to screens that choose a model or connect a provider (§10.1). */

import { uiTokens } from "@langwatch/module";

/** What a screen hands model-provider's form for adding or editing one provider's credentials. */
export type EditModelProviderFormProps = {
  providerKey: string;
  /** `"new"` adds the provider; otherwise the stored provider being edited. */
  modelProviderId?: string;
  organizationId?: string | undefined;
  projectId?: string | undefined;
  /** What "the credential is saved" means to a surface that is not the settings drawer. */
  onSaved?: (saved: { chatModel?: string }) => void;
  /** Onboarding's presentation: Connect wording, model pills, no settings chrome. */
  guided?: boolean;
  /** Why the connection did not happen: a refused credential, or a failed or timed-out sign-in. */
  onFailed?: (failure: { provider: string; code: string }) => void;
};

/**
 * A model LangWatch serves itself, offered without a provider of the project's own.
 * `isOffered: false` keeps it out of the options while a saved choice still reads by its label.
 */
export type LentBuiltInModel = { value: string; label: string; isOffered?: boolean };

/** What a screen hands model-provider's display of one chosen model. */
export type ModelDisplayProps = {
  model: string;
  fontSize?: string;
  /** Built-in models the chosen one may be, so it reads by its label. */
  builtInModels?: readonly LentBuiltInModel[];
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
  /** Models listed first, even for a project with no provider configured. */
  builtInModels?: readonly LentBuiltInModel[];
};

export const EditModelProviderFormToken =
  uiTokens("model-provider").component<EditModelProviderFormProps>("editModelProviderForm");
export const ModelDisplayToken =
  uiTokens("model-provider").component<ModelDisplayProps>("modelDisplay");
export const ModelSelectorToken =
  uiTokens("model-provider").component<ModelSelectorProps>("modelSelector");
