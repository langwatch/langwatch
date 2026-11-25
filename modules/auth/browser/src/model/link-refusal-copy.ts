import { z } from "zod";

/**
 * The words for a refused `/link-social`. Its body is the server's, and whatever stands in front
 * of it may answer with something that is not JSON, so only a known code picks a sentence and
 * nothing the server wrote is ever shown (specs/settings/change-password-auth0.feature).
 */
const GENERIC_LINK_REFUSAL = "We could not connect this sign-in method. Try again in a moment.";

const LINK_REFUSAL_COPY: ReadonlyMap<string, string> = new Map([
  ["PROVIDER_NOT_FOUND", "This sign-in method is not available here."],
]);

/** Better Auth's error body: only the code is read. */
const linkRefusalBody = z.object({ code: z.string() });

/** The sentence for one refused link's response body, the generic one unless its code is known. */
export function linkRefusalReason({ body }: { body: string }): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return GENERIC_LINK_REFUSAL;
  }
  const read = linkRefusalBody.safeParse(parsed);
  if (!read.success) return GENERIC_LINK_REFUSAL;
  return LINK_REFUSAL_COPY.get(read.data.code) ?? GENERIC_LINK_REFUSAL;
}
