import crypto from "crypto";

/**
 * Sign a request body for the langwatch_nlp Go service (`services/nlpgo`).
 *
 * Mirrors the verifier at services/nlpgo/adapters/httpapi/middleware.go —
 * `hmac-sha256(LW_NLPGO_INTERNAL_SECRET, raw_body)` returned as a hex
 * string. The Go side reads the signature from `X-LangWatch-NLPGO-Signature`
 * and rejects unsigned (or mismatched) requests with 401.
 *
 * NOTE: the canonical input is body-only — no method/path/timestamp —
 * which means a captured request can be replayed indefinitely. Callers
 * SHOULD include a unique nonce (request id, trace id, or random uuid)
 * inside the body so replays are at worst idempotent. We will harden
 * to the gateway-style canonical (METHOD\nPATH\nTS\nBODYHASH) in a
 * follow-up that touches both sides in lockstep.
 */
export function signNLPGORequest(secret: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}
