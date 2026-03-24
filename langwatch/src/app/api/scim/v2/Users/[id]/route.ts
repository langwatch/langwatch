import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "~/server/db";
import {
  authenticateScimRequest,
  ScimAuthError,
} from "~/server/scim/scim-auth.middleware";
import { ScimService } from "~/server/scim/scim.service";
import { scimCreateUserRequestSchema, scimPatchRequestSchema } from "~/server/scim/scim.types";
import type { ScimError } from "~/server/scim/scim.types";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const auth = await authenticateScimRequest(request);
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
  } catch (e) {
    if (e instanceof ScimAuthError) return e.response;
    throw e;
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const auth = await authenticateScimRequest(request);
    const { id } = await context.params;
    const scimService = ScimService.create(prisma);

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

    const parsed = scimCreateUserRequestSchema.safeParse(body);
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

    const result = await scimService.replaceUser({
      id,
      organizationId: auth.organizationId,
      request: parsed.data,
    });

    if (isScimError(result)) {
      return NextResponse.json(result, { status: parseInt(result.status, 10) });
    }

    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ScimAuthError) return e.response;
    throw e;
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const auth = await authenticateScimRequest(request);
    const { id } = await context.params;
    const scimService = ScimService.create(prisma);

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

    const result = await scimService.updateUser({
      id,
      organizationId: auth.organizationId,
      patchRequest: parsed.data,
    });

    if (isScimError(result)) {
      return NextResponse.json(result, { status: parseInt(result.status, 10) });
    }

    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ScimAuthError) return e.response;
    throw e;
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const auth = await authenticateScimRequest(request);
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
  } catch (e) {
    if (e instanceof ScimAuthError) return e.response;
    throw e;
  }
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
