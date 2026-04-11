import { NextResponse } from "next/server";
import { prisma } from "../db";
import { ScimTokenService } from "./scim-token.service";
import type { ScimError } from "./scim.types";

/**
 * Authenticates a SCIM request by extracting the Bearer token from the Authorization header
 * and verifying it against stored hashed tokens.
 *
 * Returns the organizationId on success, or a 401 NextResponse on failure.
 */
export async function authenticateScimRequest(
  request: Request
): Promise<{ organizationId: string } | NextResponse<ScimError>> {
  const authHeader = request.headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json(
      {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"] as const,
        status: "401",
        detail: "Bearer token is required",
      },
      { status: 401 }
    );
  }

  const token = authHeader.slice(7);
  const tokenService = ScimTokenService.create(prisma);
  const result = await tokenService.verify({ token });

  if (!result) {
    return NextResponse.json(
      {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"] as const,
        status: "401",
        detail: "Invalid or expired token",
      },
      { status: 401 }
    );
  }

  return { organizationId: result.organizationId };
}

/** Type guard to check if the auth result is an error response. */
export function isAuthError(
  result: { organizationId: string } | NextResponse<ScimError>
): result is NextResponse<ScimError> {
  return result instanceof NextResponse;
}
