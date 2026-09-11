/**
 * The voices the caller Voice picker may offer: the explicit `CALLER_VOICES`
 * list, kept only for providers the project has credentials for. Not
 * catalog-driven — the SDK maps a caller voice to a fixed TTS model and reads
 * only the voice name, so a catalog model id would be the wrong shape.
 */

import { CALLER_VOICES } from "~/server/scenarios/voice/caller-voice.config";

/** The provider fields the picker needs from the frontend provider query. */
export interface ProviderCredentialView {
  provider: string;
  enabled?: boolean;
}

/**
 * The picker inputs for a project's caller voices: the `"provider/voice"`
 * values to offer and their capitalised display labels, keyed by value. A
 * provider counts as credentialed when it is enabled for the project, the same
 * signal the chat picker uses; a project with no such provider yields no
 * options, so the picker shows its "add a provider" empty state.
 */
export function callerVoiceOptions({
  providers,
}: {
  providers: ProviderCredentialView[];
}): {
  options: string[];
  displayNames: Record<string, string>;
} {
  const enabledProviders = new Set(
    providers
      .filter((provider) => provider.enabled === true)
      .map((provider) => provider.provider),
  );
  const voices = CALLER_VOICES.filter((voice) =>
    enabledProviders.has(voice.provider),
  );
  return {
    options: voices.map((voice) => voice.value),
    displayNames: Object.fromEntries(
      voices.map((voice) => [voice.value, voice.label]),
    ),
  };
}
