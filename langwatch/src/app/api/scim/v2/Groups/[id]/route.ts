import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "~/server/db";
import {
  authenticateScimRequest,
  isAuthError,
} from "~/server/scim/scim-auth.middleware";
import { ScimGroupService } from "~/server/scim/scim-group.service";
import {
  scimPatchRequestSchema,
  scimReplaceGroupRequestSchema,
} from "~/server/scim/scim.types";
import type { ScimError } from "~/server/scim/scim.types";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await authenticateScimRequest(request);
  if (isAuthError(auth)) return auth;

  const { id } = await context.params;
  const service = ScimGroupService.create(prisma);

  const result = await service.getGroup({
    externalScimId: id,
    organizationId: auth.organizationId,
  });

  if (isScimError(result)) {
    return NextResponse.json(result, { status: parseInt(result.status, 10) });
  }

  return NextResponse.json(result);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await authenticateScimRequest(request);
  if (isAuthError(auth)) return auth;

  const { id } = await context.params;
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

  const parsed = scimReplaceGroupRequestSchema.safeParse(body);
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

  const result = await service.replaceGroup({
    externalScimId: id,
    organizationId: auth.organizationId,
    request: parsed.data,
  });

  if (isScimError(result)) {
    return NextResponse.json(result, { status: parseInt(result.status, 10) });
  }

  return NextResponse.json(result);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await authenticateScimRequest(request);
  if (isAuthError(auth)) return auth;

  const { id } = await context.params;
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

  const parsed = scimPatchRequestSchema.safeParse(body);
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

  const result = await service.updateGroup({
    externalScimId: id,
    organizationId: auth.organizationId,
    patchRequest: parsed.data,
  });

  if (isScimError(result)) {
    return NextResponse.json(result, { status: parseInt(result.status, 10) });
  }

  return NextResponse.json(result);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await authenticateScimRequest(request);
  if (isAuthError(auth)) return auth;

  const { id } = await context.params;
  const service = ScimGroupService.create(prisma);

  const result = await service.deleteGroup({
    externalScimId: id,
    organizationId: auth.organizationId,
  });

  if (result && isScimError(result)) {
    return NextResponse.json(result, { status: parseInt(result.status, 10) });
  }

  return new NextResponse(null, { status: 204 });
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
