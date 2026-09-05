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
} from "@ee/scim/openapi";
import { ScimService } from "@ee/scim/scim.service";
import {
  isScimError,
  scimCreateGroupRequestSchema,
  scimCreateUserRequestSchema,
  scimPatchRequestSchema,
  scimReplaceGroupRequestSchema,
} from "@ee/scim/scim.types";
import { ScimGroupService } from "@ee/scim/scim-group.service";
import { ScimTokenService } from "@ee/scim/scim-token.service";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { Context, MiddlewareHandler } from "hono";
import { describeRoute } from "hono-openapi";
import type { ZodError } from "zod";
import { ENTERPRISE_FEATURE_ERRORS } from "~/server/api/enterprise";
import {
  createServiceApp,
  internalSecret,
  publicEndpoint,
} from "~/server/api/security";
import { prisma } from "~/server/db";
import {
  type ScimRefusalReason,
  ScimRequestLogService,
} from "./scim-request-log.service";

/**
 * What the bearer credential resolved to, set by {@link scimAuth}: the
 * organization, and the CONNECTION the token was issued for — the whole of
 * its write authority (D08). `scimConnectionId` is null only for a token
 * minted before connection scoping whose organization had no connection to
 * be backfilled onto; such a token keeps the organization-wide authority it
 * was sold with.
 */
type ScimEnv = {
  Variables: {
    scimOrganizationId: string;
    scimConnectionId: string | null;
    /** An override for the slug the status would otherwise imply, set only
     *  where two refusals share a status and mean different things. The
     *  recorder reads it once, after the handler returns. */
    scimRefusalReason: ScimRefusalReason | null;
    /** Our own sentence for the refusal, recorded beside the slug. */
    scimRefusalDetail: string | null;
  };
};

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

const logger = createLogger("langwatch:scim:routes");

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
/**
 * The resource a request asked for, as a person reads it.
 *
 * Never the raw path: it carries ids and query strings, and this string is
 * rendered on a settings page rather than matched by a machine. An id
 * collapses to `:id` so "the same thing, forty times" reads as forty rows of
 * one shape instead of forty different-looking ones.
 */
function scimResourceOf(path: string): string {
  const tail = path.replace(/^.*\/scim\/v2\/?/, "").split("?")[0] ?? "";
  if (!tail) return "/";
  const [head, ...rest] = tail.split("/");
  return rest.length > 0 ? `${head}/:id` : (head ?? "/");
}

/**
 * What a status means, when nothing said otherwise.
 *
 * The slug exists so a reader branches on it rather than on our prose, and
 * most statuses mean exactly one thing here. Where two refusals share a
 * status and do not share a meaning — an unparseable body against a body that
 * parsed and was not a valid resource — the handler overrides it.
 */
function refusalReasonFor(status: number): ScimRefusalReason {
  if (status === 401) return "unauthorized";
  // A 403 is "you may not", and a lapsed plan is only ONE of the ways to
  // earn one. `assertWritable` answers 403 when a provider touches somebody
  // another connection provisioned, so filing every 403 as a plan lapse told
  // an administrator on the ADR-126 activity page — the surface built to
  // answer "why did my sync stop" — that their Enterprise plan no longer
  // includes SCIM, when their provider was simply pointed at the wrong
  // connection. The entitlement middleware records its own reason; anything
  // else that answers 403 says so without naming a cause it does not know.
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 400) return "invalid_resource";
  if (status === 429) return "rate_limited";
  // 405 and 415 are the router's own answers rather than a handler's, and
  // they are refusals of the CALLER's request. Reading them as
  // `internal_error` puts "LangWatch broke" on an operator's page for a
  // method or a content type their provider chose.
  if (status === 405 || status === 415 || status === 501) return "unsupported";
  return "internal_error";
}

/**
 * A body we could not parse at all, said in our own words.
 *
 * Distinguished from a body that parsed and was not a valid resource, because
 * an administrator can act on the difference: one is the provider sending
 * something that is not JSON, the other is a resource missing a field.
 */
function malformedBody(c: Context) {
  const detail = "The request body could not be read as JSON";
  c.set("scimRefusalReason", "malformed_body");
  c.set("scimRefusalDetail", detail);
  return scimError(c, 400, detail);
}

/**
 * A resource that parsed and is not one we can accept.
 *
 * OUR SENTENCE, NAMING THE FIELDS — never the validator's. `parsed.error.message`
 * was going out on the wire, so an identity provider was told "String must
 * contain at least 1 character(s)" by a library we happen to use, and the row
 * this refusal is recorded in would have carried it too. The payload rule is
 * the same one `scim_apply_failed` keeps: a code and our own words, never
 * somebody else's message. The field paths ARE ours and are what makes the
 * refusal actionable, so they stay.
 */
function invalidResource(c: Context, error: ZodError) {
  const fields = [
    ...new Set(
      error.issues
        .map((issue) => issue.path.join("."))
        .filter((path) => path.length > 0),
    ),
  ];
  const detail =
    fields.length > 0
      ? `The resource is not valid: ${fields.join(", ")}`
      : "The resource is not valid";
  // Recorded as well as sent. The field paths are the whole of what makes
  // this refusal actionable, and a row that carries the slug without them
  // shows an administrator "invalid_resource" and nothing to do about it.
  c.set("scimRefusalReason", "invalid_resource");
  c.set("scimRefusalDetail", detail);
  return scimError(c, 400, detail);
}

const scimAuth: MiddlewareHandler<ScimEnv> = async (c, next) => {
  const authHeader = c.req.header("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    // Unattributable by construction — there is no organization to file it
    // under, and a table unauthenticated traffic can write is a table anybody
    // can fill (ADR-126). `ScimToken.lastUsedAt` staying null is the answer.
    return scimError(c, 401, "Bearer token is required");
  }

  const token = authHeader.slice(7);
  const tokenService = ScimTokenService.create(prisma);
  const result = await tokenService.verifyEntitled({ token });

  if (result.status === "invalid_token") {
    return scimError(c, 401, "Bearer token is not valid");
  }

  const requests = ScimRequestLogService.create(prisma);
  const record = async ({
    organizationId,
    connectionId,
    status,
    reason,
    detail,
  }: {
    organizationId: string;
    connectionId: string | null;
    status: number;
    reason: ScimRefusalReason | null;
    detail: string | null;
  }) =>
    requests.record({
      organizationId,
      connectionId,
      method: c.req.method,
      resource: scimResourceOf(c.req.path),
      status,
      reason,
      detail,
    });

  if (result.status === "plan_not_entitled") {
    // Recorded, unlike the 401s above: a lapsed plan is a credential we
    // recognize, so we know whose page it belongs on.
    await record({
      organizationId: result.organizationId,
      // The token names its connection even when the plan has lapsed, and the
      // only reader queries by a concrete connection id. Filed under null,
      // this row was written where nobody could ever read it.
      connectionId: result.connectionId,
      status: 403,
      reason: "plan_not_entitled",
      detail: ENTERPRISE_FEATURE_ERRORS.SCIM,
    });
    return scimError(c, 403, ENTERPRISE_FEATURE_ERRORS.SCIM);
  }

  c.set("scimOrganizationId", result.organizationId);
  c.set("scimConnectionId", result.connectionId);
  c.set("scimRefusalReason", null);
  c.set("scimRefusalDetail", null);
  try {
    await next();
  } finally {
    // `finally`, so a handler that threw is recorded as the 500 the error
    // handler turned it into.
    //
    // `c.finalized` rather than `c.res?.status`: Hono's `res` getter is
    // `this.#res ||= createResponseInstance(...)`, so it NEVER returns
    // undefined and the `?? 500` was dead — and on the one path where no
    // response was set it lazily fabricates one whose status is 200. That
    // path is reachable (a throw that is not an `Error` is rethrown past the
    // error handler), and it recorded a 200 for a request the caller was
    // never given a 200 for.
    const status = c.finalized ? c.res.status : 500;
    // NOT awaited. The record is an observation of a request that has already
    // been answered, and awaiting it put a database write on the critical
    // path of every SCIM call — including the hundreds of reads a full sync
    // issues. `record` swallows and logs its own failure, so there is no
    // rejection to lose.
    void record({
      organizationId: result.organizationId,
      connectionId: result.connectionId,
      status,
      reason:
        status >= 400
          ? (c.get("scimRefusalReason") ?? refusalReasonFor(status))
          : null,
      detail: c.get("scimRefusalDetail") ?? null,
    });
  }
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
    describeRoute(GET_SERVICE_PROVIDER_CONFIG),
    (c) => {
      return c.json({
        schemas: [
          "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig",
        ],
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
            description:
              "Authentication scheme using the OAuth Bearer Token standard",
          },
        ],
      });
    },
  );

// ── ResourceTypes ────────────────────────────────────────────────────

secured
  .access(SCIM_DISCOVERY_POLICY)
  .get("/ResourceTypes", describeRoute(LIST_RESOURCE_TYPES), (c) => {
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

secured
  .access(SCIM_DISCOVERY_POLICY)
  .get("/Schemas", describeRoute(LIST_SCHEMAS), (c) => {
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
            location:
              "/api/scim/v2/Schemas/urn:ietf:params:scim:schemas:core:2.0:Group",
          },
        },
      ],
    });
  });

// ── Users ────────────────────────────────────────────────────────────

secured
  .access(SCIM_POLICY)
  .get("/Users", describeRoute(LIST_USERS), async (c) => {
    const organizationId = c.get("scimOrganizationId");

    const scimService = ScimService.create({ prisma });

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
  .post("/Users", describeRoute(CREATE_USER), async (c) => {
    const organizationId = c.get("scimOrganizationId");

    const scimService = ScimService.create({ prisma });

    const body = await parseJsonBody(c);
    if (body === null) {
      return malformedBody(c);
    }

    const parsed = scimCreateUserRequestSchema.safeParse(body);
    if (!parsed.success) {
      return invalidResource(c, parsed.error);
    }

    const result = await scimService.createUser({
      request: parsed.data,
      organizationId,
      connectionId: c.get("scimConnectionId"),
    });

    if (isScimError(result)) {
      return scimJson(c, result, parseInt(result.status, 10));
    }

    return scimJson(c, result, 201);
  });

secured
  .access(SCIM_POLICY)
  .get("/Users/:id", describeRoute(GET_USER), async (c) => {
    const organizationId = c.get("scimOrganizationId");

    const { id } = c.req.param();
    const scimService = ScimService.create({ prisma });

    const result = await scimService.getUser({ id, organizationId });

    if (isScimError(result)) {
      return scimJson(c, result, parseInt(result.status, 10));
    }

    return scimJson(c, result);
  });

secured
  .access(SCIM_POLICY)
  .put("/Users/:id", describeRoute(REPLACE_USER), async (c) => {
    const organizationId = c.get("scimOrganizationId");

    const { id } = c.req.param();
    const scimService = ScimService.create({ prisma });

    const body = await parseJsonBody(c);
    if (body === null) {
      return malformedBody(c);
    }

    const parsed = scimCreateUserRequestSchema.safeParse(body);
    if (!parsed.success) {
      return invalidResource(c, parsed.error);
    }

    const result = await scimService.replaceUser({
      id,
      organizationId,
      request: parsed.data,
      connectionId: c.get("scimConnectionId"),
    });

    if (isScimError(result)) {
      return scimJson(c, result, parseInt(result.status, 10));
    }

    return scimJson(c, result);
  });

secured
  .access(SCIM_POLICY)
  .patch("/Users/:id", describeRoute(PATCH_USER), async (c) => {
    const organizationId = c.get("scimOrganizationId");

    const { id } = c.req.param();
    const scimService = ScimService.create({ prisma });

    const body = await parseJsonBody(c);
    if (body === null) {
      return malformedBody(c);
    }

    const parsed = scimPatchRequestSchema.safeParse(body);
    if (!parsed.success) {
      return invalidResource(c, parsed.error);
    }

    const result = await scimService.updateUser({
      id,
      organizationId,
      patchRequest: parsed.data,
      connectionId: c.get("scimConnectionId"),
    });

    if (isScimError(result)) {
      return scimJson(c, result, parseInt(result.status, 10));
    }

    return scimJson(c, result);
  });

secured
  .access(SCIM_POLICY)
  .delete("/Users/:id", describeRoute(DELETE_USER), async (c) => {
    const organizationId = c.get("scimOrganizationId");

    const { id } = c.req.param();
    const scimService = ScimService.create({ prisma });

    const result = await scimService.deleteUser({
      id,
      organizationId,
      connectionId: c.get("scimConnectionId"),
    });

    if (result && isScimError(result)) {
      return scimJson(c, result, parseInt(result.status, 10));
    }

    return c.body(null, 204);
  });

// ── Groups ───────────────────────────────────────────────────────────

secured
  .access(SCIM_POLICY)
  .get("/Groups", describeRoute(LIST_GROUPS), async (c) => {
    const organizationId = c.get("scimOrganizationId");

    const service = ScimGroupService.create({ prisma });

    const excludedAttributes = (c.req.query("excludedAttributes") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const result = await service.listGroups({
      organizationId,
      connectionId: c.get("scimConnectionId"),
      filter: c.req.query("filter") ?? undefined,
      startIndex: positiveIntegerQuery(c.req.query("startIndex"), 1),
      count: pageSizeQuery(c.req.query("count")),
      excludeMembers: excludedAttributes.includes("members"),
    });

    return scimJson(c, result);
  });

secured
  .access(SCIM_POLICY)
  .post("/Groups", describeRoute(CREATE_GROUP), async (c) => {
    const organizationId = c.get("scimOrganizationId");

    const service = ScimGroupService.create({ prisma });

    const body = await parseJsonBody(c);
    if (body === null) {
      return malformedBody(c);
    }

    const parsed = scimCreateGroupRequestSchema.safeParse(body);
    if (!parsed.success) {
      return invalidResource(c, parsed.error);
    }

    const result = await service.createGroup({
      request: parsed.data,
      organizationId,
      connectionId: c.get("scimConnectionId"),
    });

    if (isScimError(result)) {
      return scimJson(c, result, parseInt(result.status, 10));
    }

    return scimJson(c, result, 201);
  });

secured
  .access(SCIM_POLICY)
  .get("/Groups/:id", describeRoute(GET_GROUP), async (c) => {
    const organizationId = c.get("scimOrganizationId");

    const { id } = c.req.param();

    const excludedAttributes = (c.req.query("excludedAttributes") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const result = await ScimGroupService.create({ prisma }).getGroup({
      scimResourceId: id,
      organizationId,
      connectionId: c.get("scimConnectionId"),
      excludeMembers: excludedAttributes.includes("members"),
    });

    if (isScimError(result)) {
      return scimJson(c, result, parseInt(result.status, 10));
    }

    return scimJson(c, result);
  });

secured
  .access(SCIM_POLICY)
  .put("/Groups/:id", describeRoute(REPLACE_GROUP), async (c) => {
    const organizationId = c.get("scimOrganizationId");

    const { id } = c.req.param();

    const body = await parseJsonBody(c);
    if (body === null) {
      return malformedBody(c);
    }

    const parsed = scimReplaceGroupRequestSchema.safeParse(body);
    if (!parsed.success) {
      return invalidResource(c, parsed.error);
    }

    const result = await ScimGroupService.create({ prisma }).replaceGroup({
      scimResourceId: id,
      organizationId,
      connectionId: c.get("scimConnectionId"),
      request: parsed.data,
    });

    if (isScimError(result)) {
      return scimJson(c, result, parseInt(result.status, 10));
    }

    return scimJson(c, result);
  });

secured
  .access(SCIM_POLICY)
  .patch("/Groups/:id", describeRoute(PATCH_GROUP), async (c) => {
    const organizationId = c.get("scimOrganizationId");

    const { id } = c.req.param();

    const body = await parseJsonBody(c);
    if (body === null) {
      return malformedBody(c);
    }

    const parsed = scimPatchRequestSchema.safeParse(body);
    if (!parsed.success) {
      return invalidResource(c, parsed.error);
    }

    const result = await ScimGroupService.create({ prisma }).updateGroup({
      scimResourceId: id,
      organizationId,
      connectionId: c.get("scimConnectionId"),
      patchRequest: parsed.data,
    });

    if (isScimError(result)) {
      return scimJson(c, result, parseInt(result.status, 10));
    }

    return scimJson(c, result);
  });

secured
  .access(SCIM_POLICY)
  .delete("/Groups/:id", describeRoute(DELETE_GROUP), async (c) => {
    const organizationId = c.get("scimOrganizationId");

    const { id } = c.req.param();
    const result = await ScimGroupService.create({ prisma }).deleteGroup({
      scimResourceId: id,
      organizationId,
      connectionId: c.get("scimConnectionId"),
    });

    if (result && isScimError(result)) {
      return scimJson(c, result, parseInt(result.status, 10));
    }

    return c.body(null, 204);
  });

/**
 * The family's own error shape (D08).
 *
 * The caller here is an identity provider speaking SCIM, not one of our
 * clients, so a refusal has to arrive as RFC 7644's error resource rather
 * than the app's JSON envelope — an Okta or Entra sync reads `status` and
 * `detail` and nothing else, and a shape it cannot parse reads as an outage.
 *
 * A `HandledError` is a refusal we can name, so its status and its
 * customer-safe message travel. Anything else is a 500 with no detail beyond
 * that: an unhandled failure has nothing a customer could act on, and its
 * internals belong in the log line the framework already wrote, never in a
 * response body. The `code` rides in `scimType` so a provisioning tool can
 * branch on the stable slug rather than on prose.
 */
secured.hono.onError((error, c) => {
  if (error instanceof HandledError) {
    // The refusal names ITSELF on the activity feed. Without this the record
    // falls back to whatever the status alone implies, which is a guess about
    // a cause the error already knows.
    c.set("scimRefusalReason", refusalReasonFor(error.httpStatus));
    c.set("scimRefusalDetail", error.message);
    return new Response(
      JSON.stringify({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        status: String(error.httpStatus),
        scimType: error.code,
        detail: error.message,
      }),
      {
        status: error.httpStatus,
        headers: new Headers({ "Content-Type": "application/scim+json" }),
      },
    );
  }
  logger.error(
    { error, path: c.req.path },
    "unhandled failure on a SCIM route",
  );
  return scimError(c, 500, "The request could not be completed");
});

export const app = secured.hono;
