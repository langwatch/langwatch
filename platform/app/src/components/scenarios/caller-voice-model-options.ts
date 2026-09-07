/**
 * The models the caller Voice picker may offer: audio (or realtime) models the
 * project has credentials for. Reuses the shared `isSelectableVoiceModel`
 * predicate so the picker and the server agree on what counts as a voice model,
 * and reads mode from the same registry the chat picker reads — so the chat and
 * embedding pickers are untouched (AC18).
 */

import { allLitellmModels } from "~/server/modelProviders/registry";
import { isSelectableVoiceModel } from "~/server/scenarios/voice/caller-voice.config";

/** The provider fields the picker needs from the frontend provider query. */
export interface ProviderCredentialView {
  provider: string;
  enabled?: boolean;
}

/**
 * Full `provider/model` ids for every credentialed audio/realtime model, sorted.
 * A provider counts as credentialed when it is enabled for the project, the same
 * signal the chat picker uses.
 */
export function audioModelOptions(
  providers: ProviderCredentialView[],
): string[] {
  const enabledKeys = new Set(
    providers
      .filter((provider) => provider.enabled === true)
      .map((p) => p.provider),
  );
  return Object.entries(allLitellmModels)
    .filter(([id, model]) =>
      isSelectableVoiceModel({
        mode: model.mode,
        hasCredentials: enabledKeys.has(id.split("/")[0] ?? ""),
      }),
    )
    .map(([id]) => id)
    .sort();
}
