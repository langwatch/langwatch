// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Token utilities for UserIngestionBinding.
 *
 * Format: `ik-lw-<base32>`
 *   - prefix: `ik-lw-` (ingestion key, LangWatch) — function-named, paired
 *     with `sk-lw-` (secret), `vk-lw-` (virtual), `pat-lw-` (legacy). Used
 *     by the receiver to discriminate token kinds at auth time.
 *   - base32 body: 48 chars from the URL-safe Crockford-ish alphabet, no
 *     padding. Matches the entropy budget of `pat-lw-` PAT secrets while
 *     staying single-segment (no internal `_` split — receiver hashes the
 *     full post-prefix string for O(1) indexed lookup).
 *
 * Hard-cut rotation v1: `bindingAccessTokenHash` replaces in-place on
 * rotate. Receiver looks up SHA-256(incoming Bearer body) against the
 * indexed column. No previous-hash, no grace window.
 */
import crypto from "node:crypto";
import { customAlphabet } from "nanoid";

export const BINDING_TOKEN_PREFIX = "ik-lw-" as const;
export const BINDING_TOKEN_PREFIX_DISPLAY_LENGTH = 9 as const;
const BINDING_TOKEN_BODY_LENGTH = 48 as const;
const BINDING_TOKEN_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const generateBody = customAlphabet(
  BINDING_TOKEN_ALPHABET,
  BINDING_TOKEN_BODY_LENGTH,
);

export interface IssuedBindingToken {
  /** The full plaintext token, shown ONCE to the user. */
  token: string;
  /**
   * The first 9 chars of the full token (including the `ik-lw-` prefix
   * — i.e. `ik-lw-` + 3 body chars). Stored as `bindingAccessTokenPrefix`
   * for "is this the right token" recognition in the /me Trace Ingest
   * tile. Never used for auth.
   */
  prefix: string;
  /** SHA-256 hex of the post-prefix body. Stored as
   *  `bindingAccessTokenHash`. Receiver hashes the incoming Bearer's
   *  post-prefix body and matches. */
  hash: string;
}

export function issueBindingToken(): IssuedBindingToken {
  const body = generateBody();
  const token = `${BINDING_TOKEN_PREFIX}${body}`;
  return {
    token,
    prefix: token.slice(0, BINDING_TOKEN_PREFIX_DISPLAY_LENGTH),
    hash: hashBindingTokenBody(body),
  };
}

/**
 * Strip the `ik-lw-` prefix and return the body, or `null` when the
 * input doesn't carry the binding-token prefix. Receiver uses this to
 * prefix-discriminate before hashing.
 */
export function parseBindingToken(token: string): { body: string } | null {
  if (!token.startsWith(BINDING_TOKEN_PREFIX)) return null;
  const body = token.slice(BINDING_TOKEN_PREFIX.length);
  if (!body) return null;
  return { body };
}

export function hashBindingTokenBody(body: string): string {
  return crypto.createHash("sha256").update(body).digest("hex");
}

/**
 * Computes the storage hash for a full `ik-lw-<body>` token. Convenience
 * for callers who hold the full token (e.g. install drawer issuing a
 * fresh token to the DB).
 */
export function hashFullBindingToken(token: string): string | null {
  const parsed = parseBindingToken(token);
  if (!parsed) return null;
  return hashBindingTokenBody(parsed.body);
}
