import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "~/server/db";
import {
  authenticateScimRequest,
  isAuthError,
} from "~/server/scim/scim-auth.middleware";
import { ScimService } from "~/server/scim/scim.service";
import type { ScimError } from "~/server/scim/scim.types";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await authenticateScimRequest(request);
  if (isAuthError(auth)) return auth;

  const { id } = await context.params;
  const scimService = ScimService.create(prisma);

  const result = await scimService.getUser({
    id,
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
  const scimService = ScimService.create(prisma);
  const body = await request.json();

  const result = await scimService.replaceUser({
    id,
    organizationId: auth.organizationId,
    request: body,
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
  const scimService = ScimService.create(prisma);
  const body = await request.json();

  const result = await scimService.updateUser({
    id,
    organizationId: auth.organizationId,
    patchRequest: body,
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
  const scimService = ScimService.create(prisma);

  const result = await scimService.deleteUser({
    id,
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
