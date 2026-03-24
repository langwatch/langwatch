import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "~/server/db";
import {
  authenticateScimRequest,
  isAuthError,
} from "~/server/scim/scim-auth.middleware";
import { ScimGroupService } from "~/server/scim/scim-group.service";
import { scimCreateGroupRequestSchema } from "~/server/scim/scim.types";
import type { ScimError } from "~/server/scim/scim.types";

export async function GET(request: NextRequest) {
  const auth = await authenticateScimRequest(request);
  if (isAuthError(auth)) return auth;

  const service = ScimGroupService.create(prisma);

  const searchParams = request.nextUrl.searchParams;
  const filter = searchParams.get("filter") ?? undefined;
  const startIndex = parseInt(searchParams.get("startIndex") ?? "1", 10) || 1;
  const count = parseInt(searchParams.get("count") ?? "100", 10) || 100;

  const result = await service.listGroups({
    organizationId: auth.organizationId,
    filter,
    startIndex,
    count,
  });

  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const auth = await authenticateScimRequest(request);
  if (isAuthError(auth)) return auth;

  const service = ScimGroupService.create(prisma);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        status: "400",
        detail: "Invalid JSON in request body",
      },
      { status: 400 }
    );
  }

  const parsed = scimCreateGroupRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        status: "400",
        detail: parsed.error.message,
      },
      { status: 400 }
    );
  }

  const result = await service.createGroup({
    request: parsed.data,
    organizationId: auth.organizationId,
  });

  if (isScimError(result)) {
    return NextResponse.json(result, { status: parseInt(result.status, 10) });
  }

  return NextResponse.json(result, { status: 201 });
}

function isScimError(value: unknown): value is ScimError {
  return (
    typeof value === "object" &&
    value !== null &&
    "schemas" in value &&
    Array.isArray((value as ScimError).schemas) &&
    (value as ScimError).schemas[0] ===
      "urn:ietf:params:scim:api:messages:2.0:Error"
  );
}
