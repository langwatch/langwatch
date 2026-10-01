import { z } from "zod";

/** What the approving browser is sent to next. */
export const approved = z.object({ redirect: z.string() });

/** The refusal a signed-out caller reads, in the sentence this route has always used. */
export const signedOut = z.object({ error: z.string() });

/**
 * The OAuth error shape RFC 6749 §4.1.2.1 defines — error, error_description and the
 * redirect that sends the client back to its own URI with them.
 */
export const refused = z.object({
  error: z.string(),
  error_description: z.string().optional(),
  redirect: z.string().optional(),
});

/**
 * The posted document's known fields, each read as a non-empty string or not
 * at all — a wrong-typed or blank field is absent, never a parse failure, so
 * this stays the shape check it always was rather than a new refusal class.
 */
export const postedApprovalFieldsSchema = z.object({
  projectId: z
    .string()
    .min(1)
    .optional()
    .catch(void 0),
  redirect_uri: z
    .string()
    .min(1)
    .optional()
    .catch(void 0),
  client_id: z
    .string()
    .min(1)
    .optional()
    .catch(void 0),
  code_challenge: z
    .string()
    .min(1)
    .optional()
    .catch(void 0),
  code_challenge_method: z
    .string()
    .min(1)
    .optional()
    .catch(void 0),
  state: z
    .string()
    .min(1)
    .optional()
    .catch(void 0),
});
