// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  CREATE_GROUP,
  CREATE_USER,
  DELETE_GROUP,
  DELETE_USER,
  GET_GROUP,
  GET_SERVICE_PROVIDER_CONFIG,
  GET_USER,
  LIST_GROUPS,
  LIST_RESOURCE_TYPES,
  LIST_SCHEMAS,
  LIST_USERS,
  PATCH_GROUP,
  PATCH_USER,
  REPLACE_GROUP,
  REPLACE_USER,
} from "@langwatch/enterprise-scim-server";
import {
  ScimProtocolError,
  scimCreateGroupRequestSchema,
  scimCreateUserRequestSchema,
  scimPatchRequestSchema,
  scimReplaceGroupRequestSchema,
} from "@langwatch/enterprise-scim-contract";
import type { Context, MiddlewareHandler } from "hono";
import { describeRoute } from "hono-openapi";
import { ENTERPRISE_FEATURE_ERRORS } from "@langwatch/enterprise-plan-gate";
import { createServiceApp } from "~/server/api/security";
import { internalSecret, publicEndpoint } from "@langwatch/platform-api/app-rest";

type ScimEnv = { Variables: { scimOrganizationId: string } };

const operations = {
  createGroup: CREATE_GROUP,
  createUser: CREATE_USER,
  deleteGroup: DELETE_GROUP,
  deleteUser: DELETE_USER,
  getGroup: GET_GROUP,
  getServiceProviderConfig: GET_SERVICE_PROVIDER_CONFIG,
  getUser: GET_USER,
  listGroups: LIST_GROUPS,
  listResourceTypes: LIST_RESOURCE_TYPES,
  listSchemas: LIST_SCHEMAS,
  listUsers: LIST_USERS,
  patchGroup: PATCH_GROUP,
  patchUser: PATCH_USER,
  replaceGroup: REPLACE_GROUP,
  replaceUser: REPLACE_USER,
} as const;

function scimError(_c: Context, status: number, detail: string) {
  return new Response(
    JSON.stringify({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: String(status),
      detail,
    }),
    { status, headers: { "Content-Type": "application/scim+json" } },
  );
}

function scimJson(_c: Context, data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/scim+json" },
  });
}

const scimAuth: MiddlewareHandler<ScimEnv> = async (c, next) => {
  const header = c.req.header("authorization");
  if (!header?.startsWith("Bearer ")) return scimError(c, 401, "Bearer token is required");

  const result = await c.app.scim.verifyToken({ token: header.slice(7) });
  if (result.status === "invalid_token") return scimError(c, 401, "Bearer token is not valid");
  if (result.status === "plan_not_entitled") {
    return scimError(c, 403, ENTERPRISE_FEATURE_ERRORS.SCIM);
  }

  c.set("scimOrganizationId", result.organizationId);
  await next();
};

const secured = createServiceApp<ScimEnv>({
  basePath: "/api/scim/v2",
  verifySecret: scimAuth,
  credentialClass: "scim_token",
});

secured.hono.onError((error, c) => {
  if (error instanceof ScimProtocolError) {
    return scimJson(c, error.response, Number(error.response.status));
  }
  throw error;
});

const DISCOVERY = publicEndpoint(
  "SCIM discovery metadata is served without a credential so identity providers can negotiate capabilities before a token exists",
);
const SCIM = internalSecret("SCIM bearer token verified by the app's verifySecret chain");
const MAX_PAGE_SIZE = 100;

async function json(c: Context): Promise<unknown | null> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

function positiveInteger(raw: string | undefined, fallback: number) {
  const value = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function pageSize(raw: string | undefined) {
  return Math.min(positiveInteger(raw, MAX_PAGE_SIZE), MAX_PAGE_SIZE);
}

function excludedMembers(c: Context) {
  return (c.req.query("excludedAttributes") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .includes("members");
}

secured
  .access(DISCOVERY)
  .get("/ServiceProviderConfig", describeRoute(operations.getServiceProviderConfig), (c) =>
    c.json({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
      documentationUri: "https://docs.langwatch.ai/scim",
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: MAX_PAGE_SIZE },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        {
          type: "oauthbearertoken",
          name: "OAuth Bearer Token",
          description: "Authentication scheme using the OAuth Bearer Token standard",
        },
      ],
    }),
  );

secured.access(DISCOVERY).get("/ResourceTypes", describeRoute(operations.listResourceTypes), (c) =>
  c.json({
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
        meta: { resourceType: "ResourceType", location: "/api/scim/v2/ResourceTypes/User" },
      },
      {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
        id: "Group",
        name: "Group",
        endpoint: "/api/scim/v2/Groups",
        schema: "urn:ietf:params:scim:schemas:core:2.0:Group",
        meta: { resourceType: "ResourceType", location: "/api/scim/v2/ResourceTypes/Group" },
      },
    ],
  }),
);

secured.access(DISCOVERY).get("/Schemas", describeRoute(operations.listSchemas), (c) =>
  c.json({
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
          location: "/api/scim/v2/Schemas/urn:ietf:params:scim:schemas:core:2.0:User",
        },
      },
      {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:Schema"],
        id: "urn:ietf:params:scim:schemas:core:2.0:Group",
        name: "Group",
        description: "Group (maps to a LangWatch access group)",
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
          location: "/api/scim/v2/Schemas/urn:ietf:params:scim:schemas:core:2.0:Group",
        },
      },
    ],
  }),
);

secured.access(SCIM).get("/Users", describeRoute(operations.listUsers), async (c) =>
  scimJson(
    c,
    await c.app.scim.listUsers({
      organizationId: c.get("scimOrganizationId"),
      filter: c.req.query("filter") ?? undefined,
      startIndex: positiveInteger(c.req.query("startIndex"), 1),
      count: pageSize(c.req.query("count")),
    }),
  ),
);

secured.access(SCIM).post("/Users", describeRoute(operations.createUser), async (c) => {
  const body = await json(c);
  if (body === null) return scimError(c, 400, "Invalid JSON in request body");
  const parsed = scimCreateUserRequestSchema.safeParse(body);
  if (!parsed.success) return scimError(c, 400, parsed.error.message);
  return scimJson(
    c,
    await c.app.scim.createUser({
      organizationId: c.get("scimOrganizationId"),
      request: parsed.data,
    }),
    201,
  );
});

secured
  .access(SCIM)
  .get("/Users/:id", describeRoute(operations.getUser), async (c) =>
    scimJson(
      c,
      await c.app.scim.getUser({
        id: c.req.param("id"),
        organizationId: c.get("scimOrganizationId"),
      }),
    ),
  );

secured.access(SCIM).put("/Users/:id", describeRoute(operations.replaceUser), async (c) => {
  const body = await json(c);
  if (body === null) return scimError(c, 400, "Invalid JSON in request body");
  const parsed = scimCreateUserRequestSchema.safeParse(body);
  if (!parsed.success) return scimError(c, 400, parsed.error.message);
  return scimJson(
    c,
    await c.app.scim.replaceUser({
      id: c.req.param("id"),
      organizationId: c.get("scimOrganizationId"),
      request: parsed.data,
    }),
  );
});

secured.access(SCIM).patch("/Users/:id", describeRoute(operations.patchUser), async (c) => {
  const body = await json(c);
  if (body === null) return scimError(c, 400, "Invalid JSON in request body");
  const parsed = scimPatchRequestSchema.safeParse(body);
  if (!parsed.success) return scimError(c, 400, parsed.error.message);
  return scimJson(
    c,
    await c.app.scim.updateUser({
      id: c.req.param("id"),
      organizationId: c.get("scimOrganizationId"),
      patchRequest: parsed.data,
    }),
  );
});

secured.access(SCIM).delete("/Users/:id", describeRoute(operations.deleteUser), async (c) => {
  await c.app.scim.deleteUser({
    id: c.req.param("id"),
    organizationId: c.get("scimOrganizationId"),
  });
  return c.body(null, 204);
});

secured.access(SCIM).get("/Groups", describeRoute(operations.listGroups), async (c) =>
  scimJson(
    c,
    await c.app.scim.listGroups({
      organizationId: c.get("scimOrganizationId"),
      filter: c.req.query("filter") ?? undefined,
      startIndex: positiveInteger(c.req.query("startIndex"), 1),
      count: pageSize(c.req.query("count")),
      excludeMembers: excludedMembers(c),
    }),
  ),
);

secured.access(SCIM).post("/Groups", describeRoute(operations.createGroup), async (c) => {
  const body = await json(c);
  if (body === null) return scimError(c, 400, "Invalid JSON");
  const parsed = scimCreateGroupRequestSchema.safeParse(body);
  if (!parsed.success) return scimError(c, 400, parsed.error.message);
  return scimJson(
    c,
    await c.app.scim.createGroup({
      organizationId: c.get("scimOrganizationId"),
      request: parsed.data,
    }),
    201,
  );
});

secured.access(SCIM).get("/Groups/:id", describeRoute(operations.getGroup), async (c) =>
  scimJson(
    c,
    await c.app.scim.getGroup({
      externalScimId: c.req.param("id"),
      organizationId: c.get("scimOrganizationId"),
      excludeMembers: excludedMembers(c),
    }),
  ),
);

secured.access(SCIM).put("/Groups/:id", describeRoute(operations.replaceGroup), async (c) => {
  const body = await json(c);
  if (body === null) return scimError(c, 400, "Invalid JSON");
  const parsed = scimReplaceGroupRequestSchema.safeParse(body);
  if (!parsed.success) return scimError(c, 400, parsed.error.message);
  return scimJson(
    c,
    await c.app.scim.replaceGroup({
      externalScimId: c.req.param("id"),
      organizationId: c.get("scimOrganizationId"),
      request: parsed.data,
    }),
  );
});

secured.access(SCIM).patch("/Groups/:id", describeRoute(operations.patchGroup), async (c) => {
  const body = await json(c);
  if (body === null) return scimError(c, 400, "Invalid JSON");
  const parsed = scimPatchRequestSchema.safeParse(body);
  if (!parsed.success) return scimError(c, 400, parsed.error.message);
  return scimJson(
    c,
    await c.app.scim.updateGroup({
      externalScimId: c.req.param("id"),
      organizationId: c.get("scimOrganizationId"),
      patchRequest: parsed.data,
    }),
  );
});

secured.access(SCIM).delete("/Groups/:id", describeRoute(operations.deleteGroup), async (c) => {
  await c.app.scim.deleteGroup({
    externalScimId: c.req.param("id"),
    organizationId: c.get("scimOrganizationId"),
  });
  return c.body(null, 204);
});

export const app = secured.hono;
