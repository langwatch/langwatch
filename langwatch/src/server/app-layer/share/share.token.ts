import { customAlphabet } from "nanoid";

/**
 * Share tokens are the capability that grants access to a shared trace — the
 * resource id is not. They must be unguessable. 32 chars over a 62-symbol
 * alphabet is ~190 bits of entropy, comfortably beyond brute force.
 *
 * Deliberately unprefixed, unlike the `xx-lw-` credentials (VirtualKey, API
 * keys): the token's only home is the `/share/<token>` URL, where a prefix
 * would stutter and buy nothing. Legacy links carry their old bare 21-char
 * nanoid id (~126 bits), backfilled by the rename migration — same shape.
 */
const generateToken = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  32,
);

export function generateShareToken(): string {
  return generateToken();
}
