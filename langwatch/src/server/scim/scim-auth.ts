import type { NextApiRequest } from "next";
import { prisma } from "~/server/db";
import { verifyScimToken } from "./scim-token";

/**
 * Extracts Bearer token from Authorization header, looks up the matching
 * ScimToken by prefix, then bcrypt-compares to verify.
 *
 * Uses prefix-based fast lookup: index on tokenPrefix narrows candidates
 * before expensive bcrypt compare.
 *
 * @returns organizationId if valid, throws otherwise
 */
export async function getScimOrganization({
  req,
}: {
  req: NextApiRequest;
}): Promise<string> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    throw new ScimAuthError("Missing or invalid Authorization header");
  }

  const plainToken = authHeader.slice(7);
  if (!plainToken) {
    throw new ScimAuthError("Empty bearer token");
  }

  const tokenPrefix = plainToken.substring(0, 8);

  const candidates = await prisma.scimToken.findMany({
    where: {
      tokenPrefix,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });

  for (const candidate of candidates) {
    const isValid = await verifyScimToken({
      plainToken,
      tokenHash: candidate.tokenHash,
    });
    if (isValid) {
      return candidate.organizationId;
    }
  }

  throw new ScimAuthError("Invalid bearer token");
}

export class ScimAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScimAuthError";
  }
}
