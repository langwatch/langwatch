/**
 * Project-secret names owned by the product rather than the customer.
 *
 * Leaf module (no imports) so both the secrets router AND the Langy service
 * that writes these rows can depend on it without a cycle — the router must
 * not pull in the Langy app layer just to learn a name. Same shape and reason
 * as `~/server/api-key/reserved-names`.
 */

/**
 * Holds the plaintext secret of the project's auto-provisioned Langy virtual
 * key. Langy reads it back to authenticate against the gateway, and treats its
 * presence as "this project already has a VK" — so deleting the row does not
 * just break the current key, it makes the next chat mint a duplicate VK while
 * the original stays active.
 */
export const LANGY_VK_SECRET_NAME = "langy_vk_secret";

/**
 * Secrets hidden from the project-secrets listing and refused by the by-id
 * mutations: the product created them and the product retires them, so a
 * customer editing or deleting one can only break something.
 */
export const RESERVED_PROJECT_SECRET_NAMES: string[] = [LANGY_VK_SECRET_NAME];
