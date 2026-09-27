import { z } from "zod";

/**
 * RFC 7636 §4.2: the S256 challenge, base64url of a SHA-256 digest, 43
 * characters from the unreserved set. Checked here rather than trusted,
 * because an unbounded string would be stored and compared as one.
 */
export const codeChallengeSchema = z.string().regex(/^[A-Za-z0-9._~-]{43}$/);
