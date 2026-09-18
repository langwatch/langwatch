/**
 * The voices the caller Voice picker may offer: the explicit
 * `CALLER_VOICES` list, kept only for credentialed providers. Not
 * catalog-driven — the SDK reads only the voice name off a fixed TTS model.
 */

import { CALLER_VOICES } from "@langwatch/scenario-contract";

/** The provider fields the picker needs from the frontend provider query. */
export interface ProviderCredentialView {
  provider: string;
  enabled?: boolean;
}

/**
 * The picker inputs for a project's caller voices: `"provider/voice"`
 * values and their capitalised labels, keyed by value. Credentialed means
 * enabled for the project; none credentialed shows the "add a provider" empty state.
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
