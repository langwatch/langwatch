import type { NextApiRequest } from "next";
import { env } from "~/env.mjs";

/**
 * Authenticates a SCIM request using a static bearer token from env.
 *
 * Expects: Authorization: Bearer <SCIM_TOKEN>
 * Expects: x-organization-id: <organizationId> header
 *
 * Simple env-var based auth for now — token management UI is a follow-up.
 */
export function getScimOrganization({
  req,
}: {
  req: NextApiRequest;
}): string {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    throw new ScimAuthError("Missing or invalid Authorization header");
  }

  const token = authHeader.slice(7);
  if (!env.SCIM_TOKEN || token !== env.SCIM_TOKEN) {
    throw new ScimAuthError("Invalid bearer token");
  }

  const organizationId = req.headers["x-organization-id"] as string | undefined;
  if (!organizationId) {
    throw new ScimAuthError("Missing x-organization-id header");
  }

  return organizationId;
}

export class ScimAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScimAuthError";
  }
}
