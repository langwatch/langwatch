/**
 * The shared credential that authenticates the app -> NLP engine hop, as it
 * travels on the wire. Not `Authorization: Bearer`: `/go/proxy/v1/*` is handed
 * to OpenAI-compatible clients as a baseURL and those own that header.
 * @see specs/nlp-go/internal-auth.feature
 */
export const NLP_INTERNAL_SECRET_HEADER = "X-LangWatch-NLP-Secret";

/**
 * The variable both ends read, named once: one reader is the scenario child's
 * environment allow-list, where a typo costs that process the credential and
 * every engine call it makes comes back 401.
 */
export const NLP_INTERNAL_SECRET_ENV = "LANGWATCH_NLP_INTERNAL_SECRET";

/**
 * Headers for one engine request: the credential when the deployment named
 * one, none when it did not. Blank and whitespace count as none, so an engine
 * configured with an empty value never demands a secret. Never throws.
 */
export function nlpInternalSecretHeaders({
  secret,
}: {
  secret: string | undefined;
}): Record<string, string> {
  const value = secret?.trim();
  if (!value) return {};

  return { [NLP_INTERNAL_SECRET_HEADER]: value };
}
