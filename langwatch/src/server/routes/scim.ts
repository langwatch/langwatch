/**
 * Hono routes for SCIM v2 endpoints.
 *
 * Replaces:
 * - GET/POST         /api/scim/v2/Users
 * - GET/PUT/PATCH/DELETE /api/scim/v2/Users/:id
 * - GET/POST         /api/scim/v2/Groups
 * - GET/PUT/PATCH/DELETE /api/scim/v2/Groups/:id
 * - GET              /api/scim/v2/ResourceTypes
 * - GET              /api/scim/v2/Schemas
 * - GET              /api/scim/v2/ServiceProviderConfig
 */
import type { Context } from "hono";
import { Hono } from "hono";
import { loggerMiddleware } from "~/app/api/middleware/logger";
import { tracerMiddleware } from "~/app/api/middleware/tracer";
import { prisma } from "~/server/db";
import { ScimGroupService } from "~/server/scim/scim-group.service";
import { ScimService } from "~/server/scim/scim.service";
import { ScimTokenService } from "~/server/scim/scim-token.service";
import {
  isScimError,
  scimCreateGroupRequestSchema,
  scimCreateUserRequestSchema,
  scimPatchRequestSchema,
  scimReplaceGroupRequestSchema,
} from "~/server/scim/scim.types";

const SCIM_HEADERS = { "Content-Type": "application/scim+json" };

export const app = new Hono().basePath("/api/scim/v2");
app.use(tracerMiddleware({ name: "scim-v2" }));
app.use(loggerMiddleware());

// ── helpers ──────────────────────────────────────────────────────────

function scimError(c: Context, status: number, detail: string) {
  return new Response(
    JSON.stringify({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: String(status),
      detail,
    }),
    {
      status,
      headers: new Headers({ "Content-Type": "application/scim+json" }),
    },
  );
}

function scimJson(c: Context, data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: new Headers({ "Content-Type": "application/scim+json" }),
  });
}

async function requireAuth(c: Context): Promise<string | null> {
  const authHeader = c.req.header("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7);
  const tokenService = ScimTokenService.create(prisma);
  const result = await tokenService.verify({ token });

  if (!result) {
    return null;
  }

  return result.organizationId;
}

async function parseJsonBody(c: Context): Promise<unknown | null> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

// ── ServiceProviderConfig ────────────────────────────────────────────

app.get("/ServiceProviderConfig", (c) => {
  return c.json({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    documentationUri: "https://docs.langwatch.ai/scim",
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 100 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: "oauthbearertoken",
        name: "OAuth Bearer Token",
        description:
          "Authentication scheme using the OAuth Bearer Token standard",
      },
    ],
  });
});

// ── ResourceTypes ────────────────────────────────────────────────────

app.get("/ResourceTypes", (c) => {
  return c.json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: 2,
    itemsPerPage: 2,
    startIndex: 1,
    Resources: [
      {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
        id: "User",
        name: "User",
        endpoint: "/api/scim/v2/Users",
        schema: "urn:ietf:params:scim:schemas:core:2.0:User",
        meta: {
          resourceType: "ResourceType",
          location: "/api/scim/v2/ResourceTypes/User",
        },
      },
      {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
        id: "Group",
        name: "Group",
        endpoint: "/api/scim/v2/Groups",
        schema: "urn:ietf:params:scim:schemas:core:2.0:Group",
        meta: {
          resourceType: "ResourceType",
          location: "/api/scim/v2/ResourceTypes/Group",
        },
      },
    ],
  });
});

// ── Schemas ──────────────────────────────────────────────────────────

app.get("/Schemas", (c) => {
  return c.json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: 2,
    itemsPerPage: 2,
    startIndex: 1,
    Resources: [
      {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:Schema"],
        id: "urn:ietf:params:scim:schemas:core:2.0:User",
        name: "User",
        description: "User Account",
        attributes: [
          {
            name: "userName",
            type: "string",
            multiValued: false,
            required: true,
            caseExact: false,
            mutability: "readWrite",
            returned: "default",
            uniqueness: "server",
          },
          {
            name: "name",
            type: "complex",
            multiValued: false,
            required: false,
            mutability: "readWrite",
            returned: "default",
            subAttributes: [
              {
                name: "givenName",
                type: "string",
                multiValued: false,
                required: false,
                mutability: "readWrite",
                returned: "default",
              },
              {
                name: "familyName",
                type: "string",
                multiValued: false,
                required: false,
                mutability: "readWrite",
                returned: "default",
              },
            ],
          },
          {
            name: "emails",
            type: "complex",
            multiValued: true,
            required: false,
            mutability: "readWrite",
            returned: "default",
          },
          {
            name: "active",
            type: "boolean",
            multiValued: false,
            required: false,
            mutability: "readWrite",
            returned: "default",
          },
        ],
        meta: {
          resourceType: "Schema",
          location:
            "/api/scim/v2/Schemas/urn:ietf:params:scim:schemas:core:2.0:User",
        },
      },
      {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:Schema"],
        id: "urn:ietf:params:scim:schemas:core:2.0:Group",
        name: "Group",
        description: "Group (maps to LangWatch Team)",
        attributes: [
          {
            name: "displayName",
            type: "string",
            multiValued: false,
            required: true,
            caseExact: false,
            mutability: "readWrite",
            returned: "default",
            uniqueness: "none",
          },
          {
            name: "members",
            type: "complex",
            multiValued: true,
            required: false,
            mutability: "readWrite",
            returned: "default",
            subAttributes: [
              {
                name: "value",
                type: "string",
                multiValued: false,
                required: true,
                mutability: "immutable",
                returned: "default",
                description: "The user ID of the group member",
              },
              {
                name: "display",
                type: "string",
                multiValued: false,
                required: false,
                mutability: "readOnly",
                returned: "default",
              },
            ],
          },
        ],
        meta: {
          resourceType: "Schema",
          location:
            "/api/scim/v2/Schemas/urn:ietf:params:scim:schemas:core:2.0:Group",
        },
      },
    ],
  });
});

// ── Users ────────────────────────────────────────────────────────────

app.get("/Users", async (c) => {
  const organizationId = await requireAuth(c);
  if (!organizationId) {
    return scimError(c, 401, "Bearer token is required");
  }

  const scimService = ScimService.create(prisma);

  const filter = c.req.query("filter") ?? undefined;
  const startIndex = parseInt(c.req.query("startIndex") ?? "1", 10) || 1;
  const count = parseInt(c.req.query("count") ?? "100", 10) || 100;

  const result = await scimService.listUsers({
    organizationId,
    filter,
    startIndex,
    count,
  });

  return scimJson(c, result);
});

app.post("/Users", async (c) => {
  const organizationId = await requireAuth(c);
  if (!organizationId) {
    return scimError(c, 401, "Bearer token is required");
  }

  const scimService = ScimService.create(prisma);

  const body = await parseJsonBody(c);
  if (body === null) {
    return scimError(c, 400, "Invalid JSON in request body");
  }

  const parsed = scimCreateUserRequestSchema.safeParse(body);
  if (!parsed.success) {
    return scimError(c, 400, parsed.error.message);
  }

  const result = await scimService.createUser({
    request: parsed.data,
    organizationId,
  });

  if (isScimError(result)) {
    return scimJson(c, result, parseInt(result.status, 10));
  }

  return scimJson(c, result, 201);
});

app.get("/Users/:id", async (c) => {
  const organizationId = await requireAuth(c);
  if (!organizationId) {
    return scimError(c, 401, "Bearer token is required");
  }

  const { id } = c.req.param();
  const scimService = ScimService.create(prisma);

  const result = await scimService.getUser({ id, organizationId });

  if (isScimError(result)) {
    return scimJson(c, result, parseInt(result.status, 10));
  }

  return scimJson(c, result);
});

app.put("/Users/:id", async (c) => {
  const organizationId = await requireAuth(c);
  if (!organizationId) {
    return scimError(c, 401, "Bearer token is required");
  }

  const { id } = c.req.param();
  const scimService = ScimService.create(prisma);

  const body = await parseJsonBody(c);
  if (body === null) {
    return scimError(c, 400, "Invalid JSON in request body");
  }

  const parsed = scimCreateUserRequestSchema.safeParse(body);
  if (!parsed.success) {
    return scimError(c, 400, parsed.error.message);
  }

  const result = await scimService.replaceUser({
    id,
    organizationId,
    request: parsed.data,
  });

  if (isScimError(result)) {
    return scimJson(c, result, parseInt(result.status, 10));
  }

  return scimJson(c, result);
});

app.patch("/Users/:id", async (c) => {
  const organizationId = await requireAuth(c);
  if (!organizationId) {
    return scimError(c, 401, "Bearer token is required");
  }

  const { id } = c.req.param();
  const scimService = ScimService.create(prisma);

  const body = await parseJsonBody(c);
  if (body === null) {
    return scimError(c, 400, "Invalid JSON in request body");
  }

  const parsed = scimPatchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return scimError(c, 400, parsed.error.message);
  }

  const result = await scimService.updateUser({
    id,
    organizationId,
    patchRequest: parsed.data,
  });

  if (isScimError(result)) {
    return scimJson(c, result, parseInt(result.status, 10));
  }

  return scimJson(c, result);
});

app.delete("/Users/:id", async (c) => {
  const organizationId = await requireAuth(c);
  if (!organizationId) {
    return scimError(c, 401, "Bearer token is required");
  }

  const { id } = c.req.param();
  const scimService = ScimService.create(prisma);

  const result = await scimService.deleteUser({ id, organizationId });

  if (result && isScimError(result)) {
    return scimJson(c, result, parseInt(result.status, 10));
  }

  return c.body(null, 204);
});

// ── Groups ───────────────────────────────────────────────────────────

app.get("/Groups", async (c) => {
  const organizationId = await requireAuth(c);
  if (!organizationId) {
    return scimError(c, 401, "Bearer token is required");
  }

  const service = ScimGroupService.create(prisma);

  const excludedAttributes = (c.req.query("excludedAttributes") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const result = await service.listGroups({
    organizationId,
    filter: c.req.query("filter") ?? undefined,
    startIndex: parseInt(c.req.query("startIndex") ?? "1", 10) || 1,
    count: parseInt(c.req.query("count") ?? "100", 10) || 100,
    excludeMembers: excludedAttributes.includes("members"),
  });

  return scimJson(c, result);
});

app.post("/Groups", async (c) => {
  const organizationId = await requireAuth(c);
  if (!organizationId) {
    return scimError(c, 401, "Bearer token is required");
  }

  const service = ScimGroupService.create(prisma);

  const body = await parseJsonBody(c);
  if (body === null) {
    return scimError(c, 400, "Invalid JSON");
  }

  const parsed = scimCreateGroupRequestSchema.safeParse(body);
  if (!parsed.success) {
    return scimError(c, 400, parsed.error.message);
  }

  const result = await service.createGroup({
    request: parsed.data,
    organizationId,
  });

  if (isScimError(result)) {
    return scimJson(c, result, parseInt(result.status, 10));
  }

  return scimJson(c, result, 201);
});

app.get("/Groups/:id", async (c) => {
  const organizationId = await requireAuth(c);
  if (!organizationId) {
    return scimError(c, 401, "Bearer token is required");
  }

  const { id } = c.req.param();

  const excludedAttributes = (c.req.query("excludedAttributes") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const result = await ScimGroupService.create(prisma).getGroup({
    externalScimId: id,
    organizationId,
    excludeMembers: excludedAttributes.includes("members"),
  });

  if (isScimError(result)) {
    return scimJson(c, result, parseInt(result.status, 10));
  }

  return scimJson(c, result);
});

app.put("/Groups/:id", async (c) => {
  const organizationId = await requireAuth(c);
  if (!organizationId) {
    return scimError(c, 401, "Bearer token is required");
  }

  const { id } = c.req.param();

  const body = await parseJsonBody(c);
  if (body === null) {
    return scimError(c, 400, "Invalid JSON");
  }

  const parsed = scimReplaceGroupRequestSchema.safeParse(body);
  if (!parsed.success) {
    return scimError(c, 400, parsed.error.message);
  }

  const result = await ScimGroupService.create(prisma).replaceGroup({
    externalScimId: id,
    organizationId,
    request: parsed.data,
  });

  if (isScimError(result)) {
    return scimJson(c, result, parseInt(result.status, 10));
  }

  return scimJson(c, result);
});

app.patch("/Groups/:id", async (c) => {
  const organizationId = await requireAuth(c);
  if (!organizationId) {
    return scimError(c, 401, "Bearer token is required");
  }

  const { id } = c.req.param();

  const body = await parseJsonBody(c);
  if (body === null) {
    return scimError(c, 400, "Invalid JSON");
  }

  const parsed = scimPatchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return scimError(c, 400, parsed.error.message);
  }

  const result = await ScimGroupService.create(prisma).updateGroup({
    externalScimId: id,
    organizationId,
    patchRequest: parsed.data,
  });

  if (isScimError(result)) {
    return scimJson(c, result, parseInt(result.status, 10));
  }

  return scimJson(c, result);
});

app.delete("/Groups/:id", async (c) => {
  const organizationId = await requireAuth(c);
  if (!organizationId) {
    return scimError(c, 401, "Bearer token is required");
  }

  const { id } = c.req.param();
  const result = await ScimGroupService.create(prisma).deleteGroup({
    externalScimId: id,
    organizationId,
  });

  if (result && isScimError(result)) {
    return scimJson(c, result, parseInt(result.status, 10));
  }

  return c.body(null, 204);
});
