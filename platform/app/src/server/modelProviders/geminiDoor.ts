/**
 * Which of Google's two doors a Gemini credential opens.
 *
 * A credential carrying both a project and a location is an Agent Platform
 * key and dispatches to aiplatform.googleapis.com; without them it is an AI
 * Studio key and dispatches to generativelanguage.googleapis.com. See
 * specs/model-providers/google-agent-platform.feature.
 *
 * Framework-free on purpose: the execution path (prepareLitellmParams) and
 * the read path that tells the frontend what a row can serve must decide
 * this the same way, and a second copy of the rule is how the two drift.
 */

/**
 * The Agent Platform project/location pair for a Gemini credential, or null
 * when the credential names the Gemini API door instead.
 *
 * The credential travels as a unit: a stored key only ever pairs with a
 * stored project/location, and the env pair applies only to an env-fed key.
 * Mixing sources would let an operator exporting GEMINI_PROJECT /
 * GEMINI_LOCATION silently reroute every stored AI Studio key through the
 * Agent Platform door it cannot open. Trimmed, so a whitespace-only value
 * never names the door on its own.
 */
export const geminiAgentPlatformPair = (
  customKeys: unknown,
): { project: string; location: string } | null => {
  const stored = customKeys as Record<string, string> | null | undefined;
  const keyIsStored = !!stored?.GEMINI_API_KEY;
  const project = keyIsStored
    ? stored?.GEMINI_PROJECT?.trim()
    : process.env.GEMINI_PROJECT?.trim();
  const location = keyIsStored
    ? stored?.GEMINI_LOCATION?.trim()
    : process.env.GEMINI_LOCATION?.trim();
  return project && location ? { project, location } : null;
};

/**
 * True when a row's credential cannot serve embedding models.
 *
 * Only Gemini's Agent Platform door has this shape today: it serves chat
 * but answers 404 on `:batchEmbedContents` (verified live). Every other
 * provider's rows serve whatever their catalog lists.
 */
export const rowCannotServeEmbeddings = ({
  provider,
  customKeys,
}: {
  provider: string;
  customKeys: unknown;
}): boolean =>
  provider === "gemini" && geminiAgentPlatformPair(customKeys) !== null;
