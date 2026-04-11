import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "~/server/db";
import {
  authenticateScimRequest,
  isAuthError,
} from "~/server/scim/scim-auth.middleware";
import { ScimGroupService } from "~/server/scim/scim-group.service";
import { isScimError, scimCreateGroupRequestSchema } from "~/server/scim/scim.types";

const SCIM_HEADERS = { "Content-Type": "application/scim+json" };

export async function GET(request: NextRequest) {
  const auth = await authenticateScimRequest(request);
  if (isAuthError(auth)) return auth;

  const service = ScimGroupService.create(prisma);
  const params = request.nextUrl.searchParams;

  const excludedAttributes = (params.get("excludedAttributes") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const result = await service.listGroups({
    organizationId: auth.organizationId,
    filter: params.get("filter") ?? undefined,
    startIndex: parseInt(params.get("startIndex") ?? "1", 10) || 1,
    count: parseInt(params.get("count") ?? "100", 10) || 100,
    excludeMembers: excludedAttributes.includes("members"),
  });

  return NextResponse.json(result, { headers: SCIM_HEADERS });
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
      { schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"], status: "400", detail: "Invalid JSON" },
      { status: 400, headers: SCIM_HEADERS },
    );
  }

  const parsed = scimCreateGroupRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"], status: "400", detail: parsed.error.message },
      { status: 400, headers: SCIM_HEADERS },
    );
  }

  const result = await service.createGroup({ request: parsed.data, organizationId: auth.organizationId });

  if (isScimError(result)) {
    return NextResponse.json(result, { status: parseInt(result.status, 10), headers: SCIM_HEADERS });
  }

  return NextResponse.json(result, { status: 201, headers: SCIM_HEADERS });
}
