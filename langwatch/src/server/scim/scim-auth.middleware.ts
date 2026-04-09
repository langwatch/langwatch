import { NextResponse } from "next/server";
import { prisma } from "../db";
import { ScimTokenService } from "./scim-token.service";
import type { ScimError } from "./scim.types";

/**
 * Error thrown when SCIM authentication fails.
 * Carries the pre-built NextResponse so route handlers can return it directly.
 */
export class ScimAuthError extends Error {
  constructor(public readonly response: NextResponse<ScimError>) {
    super("SCIM authentication failed");
  }
}

/**
 * Authenticates a SCIM request by extracting the Bearer token from the Authorization header
 * and verifying it against stored hashed tokens.
 *
 * Returns the organizationId on success, or throws ScimAuthError on failure.
 */
export async function authenticateScimRequest(
  request: Request
): Promise<{ organizationId: string }> {
  const authHeader = request.headers.get("authorization");
  const bearerMatch = authHeader?.match(/^Bearer\s+(.+)$/i);
  const token = bearerMatch?.[1]?.trim();

  if (!token) {
    throw new ScimAuthError(
      NextResponse.json(
        {
          schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"] as const,
          status: "401",
          detail: "Bearer token is required",
        },
        { status: 401 }
      )
    );
  }
  const tokenService = ScimTokenService.create(prisma);
  const result = await tokenService.verify({ token });

  if (!result) {
    throw new ScimAuthError(
      NextResponse.json(
        {
          schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"] as const,
          status: "401",
          detail: "Invalid or expired token",
        },
        { status: 401 }
      )
    );
  }

  return { organizationId: result.organizationId };
}
