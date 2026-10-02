/**
 * The shared secret that authenticates the app -> nlpgo hop.
 *
 * nlpgo guards every route under `/go/*` with this header when
 * `LANGWATCH_NLP_INTERNAL_SECRET` is set on its side, and accepts
 * unauthenticated calls (with a loud startup warning) when it is not. The app
 * mirrors that: it sends the header whenever the variable is set and omits it
 * otherwise, so a self-hosted install whose `.env` predates the variable keeps
 * working on both ends. The variable is never required and never throws.
 *
 * Deliberately not `Authorization: Bearer`: `/go/proxy/v1/*` is handed to
 * OpenAI-compatible clients as a baseURL and those clients own the
 * Authorization header on that lane.
 */
export const NLP_INTERNAL_SECRET_HEADER = "X-LangWatch-NLP-Secret";

/**
 * Headers to merge into every outbound nlpgo request: the secret header when
 * configured, an empty object when not.
 *
 * Read from `process.env` at call time rather than through `env.mjs` because
 * the scenario child process inherits its environment from the parent and
 * builds its requests there, and because call-time reads are what let a test
 * drive the two branches with `vi.stubEnv`.
 */
export function nlpgoInternalHeaders(): Record<string, string> {
  const secret = process.env.LANGWATCH_NLP_INTERNAL_SECRET?.trim();
  if (!secret) return {};

  return { [NLP_INTERNAL_SECRET_HEADER]: secret };
}
