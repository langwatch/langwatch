/** The credentials form model-provider lends by token to surfaces that connect one (§10.1). */

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

export const EditModelProviderFormToken =
  uiTokens("model-provider").component<EditModelProviderFormProps>("editModelProviderForm");
