// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
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

import { scimTransportOperations } from "~/runtime/app/scim/scim-transport.adapter";
import {
  ScimProtocolError,
  scimCreateGroupRequestSchema,
  scimCreateUserRequestSchema,
  scimPatchRequestSchema,
  scimReplaceGroupRequestSchema,
} from "@langwatch/enterprise-scim-contract";
import type { Context, MiddlewareHandler } from "hono";
import { describeRoute } from "hono-openapi";
import { ENTERPRISE_FEATURE_ERRORS } from "~/server/api/enterprise";
import { createServiceApp, internalSecret, publicEndpoint } from "~/server/api/security";

/** The organization the bearer credential resolved to, set by {@link scimAuth}. */
type ScimEnv = { Variables: { scimOrganizationId: string } };

/**
 * Discovery carries no credential, and the policy has to say so. RFC 7644
 * section 4 allows these three endpoints to answer without authentication, so
 * that an identity provider can read the capabilities before anyone has
 * minted a token for it, and this deployment takes that option: a `public`
 * policy applies no enforcement chain, so `scimAuth` never runs on them. They
 * answer the same bytes to anyone who asks.
 */
const SCIM_DISCOVERY_POLICY = publicEndpoint(
  "SCIM discovery metadata is served without a credential so identity providers can negotiate capabilities before a token exists",
);

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

/**
 * Resolves the organization behind the bearer credential and puts it on the
 * context, or answers the SCIM-shaped refusal (RFC 7644 error format, since
 * the caller is an identity provider speaking SCIM, not our own client).
 *
 * It runs as the `verifySecret` chain of the app, so every route declared
 * `SCIM_POLICY` is authenticated by construction and a new provisioning route
 * cannot serve traffic by forgetting to call it. The three discovery routes
 * declare `publicEndpoint` instead and the builder applies no chain to them.
 *
 * Entitlement is checked on every call, not only at mint time: a SCIM token
 * is exercised by directory sync for as long as it lives, so the plan lapsing
 * must refuse here or the sync quietly outlives the Enterprise plan it was
 * sold under. An unknown token stays 401 (retry with the right credential);
 * a real token on a lapsed plan is 403: the credential is fine, the account
 * is not, and telling the identity provider to retry would be a lie.
 */
const scimAuth: MiddlewareHandler<ScimEnv> = async (c, next) => {
  const authHeader = c.req.header("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return scimError(c, 401, "Bearer token is required");
  }

  const token = authHeader.slice(7);
  const result = await c.app.scim.verifyToken({ token });

  if (result.status === "invalid_token") {
    return scimError(c, 401, "Bearer token is not valid");
  }

  if (result.status === "plan_not_entitled") {
    return scimError(c, 403, ENTERPRISE_FEATURE_ERRORS.SCIM);
  }

  c.set("scimOrganizationId", result.organizationId);
  await next();
};

const secured = createServiceApp<ScimEnv>({
  basePath: "/api/scim/v2",
  verifySecret: scimAuth,
  // The bearer token belongs to the identity provider, not to us, so the
  // published document names the scheme it can present. Discovery keeps its
  // own `public` classification: the override renames the app's secret, and
  // discovery is reached without it.
  credentialClass: "scim_token",
});

// The service is value-or-throw; this transport is the sole place that turns
// a typed protocol failure back into the RFC 7644 Error resource.
secured.hono.onError((error, c) => {
  if (error instanceof ScimProtocolError) {
    return scimJson(c, error.response, Number(error.response.status));
  }
  throw error;
});

const SCIM_POLICY = internalSecret(
  "SCIM bearer token verified by the app's verifySecret chain",
);

async function parseJsonBody(c: Context): Promise<unknown | null> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

/**
 * The largest page any list endpoint serves, and the number
 * ServiceProviderConfig publishes as `filter.maxResults`. Both read it from
 * here so the document cannot promise a cap the handlers do not apply: a
 * `/Groups` page expands every membership unless `excludedAttributes=members`
 * is sent, so an uncapped `count` is one request that pulls the whole
 * directory.
 */
const MAX_PAGE_SIZE = 100;

/**
 * A SCIM pagination query value. RFC 7644 counts from 1 and the published
 * reference says anything that is not a positive integer falls back, so a
 * negative number is a fallback rather than an offset the store would read
 * backwards from.
 */
function positiveIntegerQuery(raw: string | undefined, fallback: number) {
  const parsed = parseInt(raw ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** A requested page size, clamped to the advertised maximum. */
function pageSizeQuery(raw: string | undefined) {
  return Math.min(positiveIntegerQuery(raw, MAX_PAGE_SIZE), MAX_PAGE_SIZE);
}

// ── ServiceProviderConfig ────────────────────────────────────────────

secured
  .access(SCIM_DISCOVERY_POLICY)
  .get(
    "/ServiceProviderConfig",
    describeRoute(scimTransportOperations.getServiceProviderConfig),
    (c) => {
      return c.json({
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
      });
    },
  );

// ── ResourceTypes ────────────────────────────────────────────────────

secured
  .access(SCIM_DISCOVERY_POLICY)
  .get(
    "/ResourceTypes",
    describeRoute(scimTransportOperations.listResourceTypes),
    (c) => {
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
    },
  );

// ── Schemas ──────────────────────────────────────────────────────────

secured
  .access(SCIM_DISCOVERY_POLICY)
  .get("/Schemas", describeRoute(scimTransportOperations.listSchemas), (c) => {
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
    });
  });

// ── Users ────────────────────────────────────────────────────────────

secured
  .access(SCIM_POLICY)
  .get("/Users", describeRoute(scimTransportOperations.listUsers), async (c) => {
    const organizationId = c.get("scimOrganizationId");

    const scimService = c.app.scim;

    const filter = c.req.query("filter") ?? undefined;
    const startIndex = positiveIntegerQuery(c.req.query("startIndex"), 1);
    const count = pageSizeQuery(c.req.query("count"));

    const result = await scimService.listUsers({
      organizationId,
      filter,
      startIndex,
      count,
    });

    return scimJson(c, result);
  });

secured
  .access(SCIM_POLICY)
  .post("/Users", describeRoute(scimTransportOperations.createUser), async (c) => {
    const organizationId = c.get("scimOrganizationId");

    const scimService = c.app.scim;

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

    return scimJson(c, result, 201);
  });

secured
  .access(SCIM_POLICY)
  .get("/Users/:id", describeRoute(scimTransportOperations.getUser), async (c) => {
    const organizationId = c.get("scimOrganizationId");

    const { id } = c.req.param();
    const scimService = c.app.scim;

    const result = await scimService.getUser({ id, organizationId });

    return scimJson(c, result);
  });

secured
  .access(SCIM_POLICY)
  .put("/Users/:id", describeRoute(scimTransportOperations.replaceUser), async (c) => {
    const organizationId = c.get("scimOrganizationId");

    const { id } = c.req.param();
    const scimService = c.app.scim;

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

    return scimJson(c, result);
  });

secured
  .access(SCIM_POLICY)
  .patch("/Users/:id", describeRoute(scimTransportOperations.patchUser), async (c) => {
    const organizationId = c.get("scimOrganizationId");

    const { id } = c.req.param();
    const scimService = c.app.scim;

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

    return scimJson(c, result);
  });

secured
  .access(SCIM_POLICY)
  .delete("/Users/:id", describeRoute(scimTransportOperations.deleteUser), async (c) => {
    const organizationId = c.get("scimOrganizationId");

    const { id } = c.req.param();
    const scimService = c.app.scim;

    await scimService.deleteUser({ id, organizationId });

    return c.body(null, 204);
  });

// ── Groups ───────────────────────────────────────────────────────────

secured
  .access(SCIM_POLICY)
  .get("/Groups", describeRoute(scimTransportOperations.listGroups), async (c) => {
    const organizationId = c.get("scimOrganizationId");

    const service = c.app.scim;

    const excludedAttributes = (c.req.query("excludedAttributes") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const result = await service.listGroups({
      organizationId,
      filter: c.req.query("filter") ?? undefined,
      startIndex: positiveIntegerQuery(c.req.query("startIndex"), 1),
      count: pageSizeQuery(c.req.query("count")),
      excludeMembers: excludedAttributes.includes("members"),
    });

    return scimJson(c, result);
  });

secured
  .access(SCIM_POLICY)
  .post("/Groups", describeRoute(scimTransportOperations.createGroup), async (c) => {
    const organizationId = c.get("scimOrganizationId");

    const service = c.app.scim;

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

    return scimJson(c, result, 201);
  });

secured
  .access(SCIM_POLICY)
  .get("/Groups/:id", describeRoute(scimTransportOperations.getGroup), async (c) => {
    const organizationId = c.get("scimOrganizationId");

    const { id } = c.req.param();

    const excludedAttributes = (c.req.query("excludedAttributes") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const result = await c.app.scim.getGroup({
      externalScimId: id,
      organizationId,
      excludeMembers: excludedAttributes.includes("members"),
    });

    return scimJson(c, result);
  });

secured
  .access(SCIM_POLICY)
  .put("/Groups/:id", describeRoute(scimTransportOperations.replaceGroup), async (c) => {
    const organizationId = c.get("scimOrganizationId");

    const { id } = c.req.param();

    const body = await parseJsonBody(c);
    if (body === null) {
      return scimError(c, 400, "Invalid JSON");
    }

    const parsed = scimReplaceGroupRequestSchema.safeParse(body);
    if (!parsed.success) {
      return scimError(c, 400, parsed.error.message);
    }

    const result = await c.app.scim.replaceGroup({
      externalScimId: id,
      organizationId,
      request: parsed.data,
    });

    return scimJson(c, result);
  });

secured
  .access(SCIM_POLICY)
  .patch("/Groups/:id", describeRoute(scimTransportOperations.patchGroup), async (c) => {
    const organizationId = c.get("scimOrganizationId");

    const { id } = c.req.param();

    const body = await parseJsonBody(c);
    if (body === null) {
      return scimError(c, 400, "Invalid JSON");
    }

    const parsed = scimPatchRequestSchema.safeParse(body);
    if (!parsed.success) {
      return scimError(c, 400, parsed.error.message);
    }

    const result = await c.app.scim.updateGroup({
      externalScimId: id,
      organizationId,
      patchRequest: parsed.data,
    });

    return scimJson(c, result);
  });

secured
  .access(SCIM_POLICY)
  .delete(
    "/Groups/:id",
    describeRoute(scimTransportOperations.deleteGroup),
    async (c) => {
      const organizationId = c.get("scimOrganizationId");

      const { id } = c.req.param();
      await c.app.scim.deleteGroup({
        externalScimId: id,
        organizationId,
      });

      return c.body(null, 204);
    },
  );

export const app = secured.hono;
