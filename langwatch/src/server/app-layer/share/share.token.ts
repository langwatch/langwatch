import { customAlphabet } from "nanoid";

/**
 * Share tokens are the capability that grants access to a shared trace — the
 * resource id is not. They must be unguessable. `share-lw-` mirrors the house
 * `xx-lw-` prefix convention (VirtualKey `vk-lw-`, API keys `sk-lw-`) so the
 * token self-identifies in logs and secret scanners. The 32-char body over a
 * 62-symbol alphabet is ~190 bits of entropy, comfortably beyond brute force.
 *
 * Legacy links predate this: their token is the old bare 21-char nanoid id
 * (~126 bits), backfilled by the rename migration. Both shapes are valid.
 */
const generateBody = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  32,
);

export const SHARE_TOKEN_PREFIX = "share-lw-";

export function generateShareToken(): string {
  return `${SHARE_TOKEN_PREFIX}${generateBody()}`;
}
