import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "~/server/db";
import {
  authenticateScimRequest,
  isAuthError,
} from "~/server/scim/scim-auth.middleware";
import { ScimGroupService } from "~/server/scim/scim-group.service";
import {
  isScimError,
  scimPatchRequestSchema,
  scimReplaceGroupRequestSchema,
} from "~/server/scim/scim.types";

type RouteContext = { params: Promise<{ id: string }> };

const SCIM_HEADERS = { "Content-Type": "application/scim+json" };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await authenticateScimRequest(request);
  if (isAuthError(auth)) return auth;

  const { id } = await context.params;
  const params = request.nextUrl.searchParams;

  const excludedAttributes = (params.get("excludedAttributes") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const result = await ScimGroupService.create(prisma).getGroup({
    externalScimId: id,
    organizationId: auth.organizationId,
    excludeMembers: excludedAttributes.includes("members"),
  });

  if (isScimError(result)) return NextResponse.json(result, { status: parseInt(result.status, 10), headers: SCIM_HEADERS });
  return NextResponse.json(result, { headers: SCIM_HEADERS });
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await authenticateScimRequest(request);
  if (isAuthError(auth)) return auth;

  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"], status: "400", detail: "Invalid JSON" },
      { status: 400, headers: SCIM_HEADERS },
    );
  }

  const parsed = scimReplaceGroupRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"], status: "400", detail: parsed.error.message },
      { status: 400, headers: SCIM_HEADERS },
    );
  }

  const result = await ScimGroupService.create(prisma).replaceGroup({
    externalScimId: id,
    organizationId: auth.organizationId,
    request: parsed.data,
  });

  if (isScimError(result)) return NextResponse.json(result, { status: parseInt(result.status, 10), headers: SCIM_HEADERS });
  return NextResponse.json(result, { headers: SCIM_HEADERS });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await authenticateScimRequest(request);
  if (isAuthError(auth)) return auth;

  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"], status: "400", detail: "Invalid JSON" },
      { status: 400, headers: SCIM_HEADERS },
    );
  }

  const parsed = scimPatchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"], status: "400", detail: parsed.error.message },
      { status: 400, headers: SCIM_HEADERS },
    );
  }

  const result = await ScimGroupService.create(prisma).updateGroup({
    externalScimId: id,
    organizationId: auth.organizationId,
    patchRequest: parsed.data,
  });

  if (isScimError(result)) return NextResponse.json(result, { status: parseInt(result.status, 10), headers: SCIM_HEADERS });
  return NextResponse.json(result, { headers: SCIM_HEADERS });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await authenticateScimRequest(request);
  if (isAuthError(auth)) return auth;

  const { id } = await context.params;
  const result = await ScimGroupService.create(prisma).deleteGroup({
    externalScimId: id,
    organizationId: auth.organizationId,
  });

  if (result && isScimError(result)) return NextResponse.json(result, { status: parseInt(result.status, 10), headers: SCIM_HEADERS });
  return new NextResponse(null, { status: 204 });
}
