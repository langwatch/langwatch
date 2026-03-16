import { randomBytes } from "crypto";
import { hash, compare } from "bcrypt";

const SCIM_TOKEN_PREFIX = "lwscim_";
const BCRYPT_ROUNDS = 10;

/**
 * Generates a SCIM bearer token with a recognizable prefix.
 * Returns the plain token (shown once), bcrypt hash (stored), and display prefix.
 */
export async function generateScimToken(): Promise<{
  plainToken: string;
  tokenHash: string;
  tokenPrefix: string;
}> {
  const randomPart = randomBytes(32).toString("hex");
  const plainToken = `${SCIM_TOKEN_PREFIX}${randomPart}`;
  const tokenHash = await hash(plainToken, BCRYPT_ROUNDS);
  const tokenPrefix = plainToken.substring(0, 8);

  return { plainToken, tokenHash, tokenPrefix };
}

/**
 * Verifies a plain SCIM token against a stored bcrypt hash.
 */
export async function verifyScimToken({
  plainToken,
  tokenHash,
}: {
  plainToken: string;
  tokenHash: string;
}): Promise<boolean> {
  return compare(plainToken, tokenHash);
}
