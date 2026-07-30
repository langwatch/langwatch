import { z } from "zod";
import { claimResultSchema } from "./claim.js";

/**
 * Passkey enrollment, driven from a phone that scanned the QR the CLI printed.
 *
 * The ceremony deliberately happens in the phone's browser rather than in the
 * terminal. WebAuthn's phishing resistance comes from the *client* binding the
 * origin into `clientDataJSON`, and only a browser can be trusted to do that
 * honestly — a CLI acting as its own client asserts whatever origin it likes,
 * which the server cannot distinguish from a lie. So the terminal shows a code
 * and polls; the phone does the crypto.
 *
 * The WebAuthn payloads themselves are passed through rather than restated:
 * they are produced and consumed by the browser API and the verifying library,
 * and a hand-written schema here would be a second, staler copy of a spec we
 * do not own.
 */
const webAuthnPayload = z.record(z.string(), z.unknown());

/** `POST /claim/handoff/:code/passkey/options` — start enrollment. */
export const passkeyRegistrationOptionsResponseSchema = z.object({
  /** Feed straight to `navigator.credentials.create()`. */
  options: webAuthnPayload,
  /** Echoed so the page can show the same code the terminal is showing. */
  userCode: z.string(),
});
export type PasskeyRegistrationOptionsResponse = z.infer<
  typeof passkeyRegistrationOptionsResponseSchema
>;

/** `POST /claim/handoff/:code/passkey/verify` — finish enrollment. */
export const passkeyVerifyRequestSchema = z.object({
  /** The `PublicKeyCredential` the browser produced, JSON-serialised. */
  response: webAuthnPayload,
  /** Optional human label for the credential, e.g. "iPhone". */
  label: z.string().min(1).max(64).optional(),
});
export type PasskeyVerifyRequest = z.infer<typeof passkeyVerifyRequestSchema>;

/**
 * Enrolling through the handoff also claims the account: the human is right
 * there, having just proved possession of the code the CLI printed, so making
 * them come back later for a separate claim step would be ceremony for its own
 * sake. The account stays claimable by token for anyone who never scans.
 */
export const passkeyVerifyResponseSchema = z.object({
  credentialId: z.string(),
  claimed: claimResultSchema,
});
export type PasskeyVerifyResponse = z.infer<typeof passkeyVerifyResponseSchema>;
