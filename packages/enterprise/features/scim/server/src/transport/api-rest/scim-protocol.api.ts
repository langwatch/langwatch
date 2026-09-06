// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// The operation descriptions come from the module that DECLARES them, not from
// this package's own barrel. The barrel re-exports this file, so importing
// through it is a cycle: under a bundler's hoisting it happens to resolve, and
// under Node's own ESM loader it is a temporal-dead-zone crash at module load
// (`Cannot access 'CREATE_GROUP' before initialization`) that takes down every
// process reaching this package.
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
} from "./scim-openapi.api.ts";
import {
  ScimProtocolError,
  scimCreateGroupRequestSchema,
  scimCreateUserRequestSchema,
  scimPatchRequestSchema,
  scimReplaceGroupRequestSchema,
} from "@langwatch/enterprise-scim-contract";
import type { Context, MiddlewareHandler } from "hono";
import { ENTERPRISE_FEATURE_ERRORS } from "@langwatch/enterprise-plan-gate";
import { internalSecret, publicEndpoint } from "@langwatch/api";
import {
  type AppRestSecurity,
  handWrittenDocs,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
} from "@langwatch/api/rest";
import { z } from "zod";
import type { ScimService } from "@langwatch/enterprise-scim-contract";

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

const scimAuth =
  (scim: () => ScimService): MiddlewareHandler<{ Variables: { scimOrganizationId: string } }> =>
  async (c, next) => {
    const header = c.req.header("authorization");
    if (!header?.startsWith("Bearer ")) return scimError(c, 401, "Bearer token is required");

    const result = await scim().verifyToken({ token: header.slice(7) });
    if (result.status === "invalid_token") return scimError(c, 401, "Bearer token is not valid");
    if (result.status === "plan_not_entitled") {
      return scimError(c, 403, ENTERPRISE_FEATURE_ERRORS.SCIM);
    }

    c.set("scimOrganizationId", result.organizationId);
    await next();
    return;
  };

/**
 * Builds the SCIM 2.0 protocol family over one process's Enterprise SCIM
 * application.
 *
 * Three of its routes are DISCOVERY and carry no credential at all: an identity
 * provider negotiates capabilities before a token exists, so `ServiceProviderConfig`,
 * `ResourceTypes` and `Schemas` answer anonymously. The other twelve are gated
 * by the bearer the organization minted, verified by {@link scimAuth} — which is
 * also where a plan that does not include directory sync becomes a 403 rather
 * than a 401, so an entitled customer with a bad token and an unentitled one
 * with a good token get different answers.
 */
export function createScimProtocolRestApp(options: {
  security: AppRestSecurity;
  scim: () => ScimService;
}): MountableRestApp {
  const { security, scim } = options;

  const { service, policy } = security.createServiceVersionedApp({
    // `/api/scim/v2` IS the SCIM 2.0 contract: the generation is the protocol
    // version, so the routes answer exactly where an identity provider is
    // already configured to reach them, with no dated namespace beside them.
    name: "scim",
    basePath: "/api/scim/v2",
    staticGeneration: "v2",
    verifySecret: scimAuth(scim),
    credentialClass: "scim_token",
    // The family's own refusals, unchanged: a SCIM error is the protocol's own
    // document, and everything else leaves this family exactly as it did
    // before — rethrown to the process boundary rather than rendered here.
    errorHandler: () => (error, c) => {
      if (error instanceof ScimProtocolError) {
        return scimJson(c, error.response, Number(error.response.status));
      }
      throw error;
    },
  });

  /** Every answer here is `application/scim+json`, written by the handler. */
  const SCIM_ANSWER =
    "SCIM 2.0 answers its own documents as application/scim+json, including the " +
    "protocol's error shape and the bodyless 204 a delete gives";

  const idParams = z.object({ id: z.string().min(1) });

  /** The two schema documents this surface publishes, verbatim. */
  const SCIM_SCHEMAS_DOCUMENT = {
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
  };

  const organizationOf = (c: Context): string => c.get("scimOrganizationId") as string;

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

  return service
    .registerRoute(
      "get",
      "/ServiceProviderConfig",
      MANAGEMENT_API_VERSION,
      (c: Context) =>
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
      (b) =>
        policy(DISCOVERY)(b)
          .withRawResponse(SCIM_ANSWER)
          .withDocs(handWrittenDocs(operations.getServiceProviderConfig)),
    )
    .registerRoute(
      "get",
      "/ResourceTypes",
      MANAGEMENT_API_VERSION,
      (c: Context) =>
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
      (b) =>
        policy(DISCOVERY)(b)
          .withRawResponse(SCIM_ANSWER)
          .withDocs(handWrittenDocs(operations.listResourceTypes)),
    )
    .registerRoute(
      "get",
      "/Schemas",
      MANAGEMENT_API_VERSION,
      (c: Context) => c.json(SCIM_SCHEMAS_DOCUMENT),
      (b) =>
        policy(DISCOVERY)(b)
          .withRawResponse(SCIM_ANSWER)
          .withDocs(handWrittenDocs(operations.listSchemas)),
    )
    .registerRoute(
      "get",
      "/Users",
      MANAGEMENT_API_VERSION,
      async (c: Context) =>
        scimJson(
          c,
          await scim().listUsers({
            organizationId: organizationOf(c),
            filter: c.req.query("filter") ?? undefined,
            startIndex: positiveInteger(c.req.query("startIndex"), 1),
            count: pageSize(c.req.query("count")),
          }),
        ),
      (b) =>
        policy(SCIM)(b)
          .withRawResponse(SCIM_ANSWER)
          .withDocs(handWrittenDocs(operations.listUsers)),
    )
    .registerRoute(
      "post",
      "/Users",
      MANAGEMENT_API_VERSION,
      async (c: Context) => {
        const body = await json(c);
        if (body === null) return scimError(c, 400, "Invalid JSON in request body");
        const parsed = scimCreateUserRequestSchema.safeParse(body);
        if (!parsed.success) return scimError(c, 400, parsed.error.message);
        return scimJson(
          c,
          await scim().createUser({
            organizationId: organizationOf(c),
            request: parsed.data,
          }),
          201,
        );
      },
      (b) =>
        policy(SCIM)(b)
          .withRawResponse(SCIM_ANSWER)
          .withDocs(handWrittenDocs(operations.createUser)),
    )
    .registerRoute(
      "get",
      "/Users/:id",
      MANAGEMENT_API_VERSION,
      async (c: Context, input: { id: string }) =>
        scimJson(
          c,
          await scim().getUser({
            id: input.id,
            organizationId: organizationOf(c),
          }),
        ),
      (b) =>
        policy(SCIM)(b)
          .withParams(idParams)
          .withRawResponse(SCIM_ANSWER)
          .withDocs(handWrittenDocs(operations.getUser)),
    )
    .registerRoute(
      "put",
      "/Users/:id",
      MANAGEMENT_API_VERSION,
      async (c: Context, input: { id: string }) => {
        const body = await json(c);
        if (body === null) return scimError(c, 400, "Invalid JSON in request body");
        const parsed = scimCreateUserRequestSchema.safeParse(body);
        if (!parsed.success) return scimError(c, 400, parsed.error.message);
        return scimJson(
          c,
          await scim().replaceUser({
            id: input.id,
            organizationId: organizationOf(c),
            request: parsed.data,
          }),
        );
      },
      (b) =>
        policy(SCIM)(b)
          .withParams(idParams)
          .withRawResponse(SCIM_ANSWER)
          .withDocs(handWrittenDocs(operations.replaceUser)),
    )
    .registerRoute(
      "patch",
      "/Users/:id",
      MANAGEMENT_API_VERSION,
      async (c: Context, input: { id: string }) => {
        const body = await json(c);
        if (body === null) return scimError(c, 400, "Invalid JSON in request body");
        const parsed = scimPatchRequestSchema.safeParse(body);
        if (!parsed.success) return scimError(c, 400, parsed.error.message);
        return scimJson(
          c,
          await scim().updateUser({
            id: input.id,
            organizationId: organizationOf(c),
            patchRequest: parsed.data,
          }),
        );
      },
      (b) =>
        policy(SCIM)(b)
          .withParams(idParams)
          .withRawResponse(SCIM_ANSWER)
          .withDocs(handWrittenDocs(operations.patchUser)),
    )
    .registerRoute(
      "delete",
      "/Users/:id",
      MANAGEMENT_API_VERSION,
      async (c: Context, input: { id: string }) => {
        await scim().deleteUser({
          id: input.id,
          organizationId: organizationOf(c),
        });
        return c.body(null, 204);
      },
      (b) =>
        policy(SCIM)(b)
          .withParams(idParams)
          .withRawResponse(SCIM_ANSWER)
          .withDocs(handWrittenDocs(operations.deleteUser)),
    )
    .registerRoute(
      "get",
      "/Groups",
      MANAGEMENT_API_VERSION,
      async (c: Context) =>
        scimJson(
          c,
          await scim().listGroups({
            organizationId: organizationOf(c),
            filter: c.req.query("filter") ?? undefined,
            startIndex: positiveInteger(c.req.query("startIndex"), 1),
            count: pageSize(c.req.query("count")),
            excludeMembers: excludedMembers(c),
          }),
        ),
      (b) =>
        policy(SCIM)(b)
          .withRawResponse(SCIM_ANSWER)
          .withDocs(handWrittenDocs(operations.listGroups)),
    )
    .registerRoute(
      "post",
      "/Groups",
      MANAGEMENT_API_VERSION,
      async (c: Context) => {
        const body = await json(c);
        if (body === null) return scimError(c, 400, "Invalid JSON");
        const parsed = scimCreateGroupRequestSchema.safeParse(body);
        if (!parsed.success) return scimError(c, 400, parsed.error.message);
        return scimJson(
          c,
          await scim().createGroup({
            organizationId: organizationOf(c),
            request: parsed.data,
          }),
          201,
        );
      },
      (b) =>
        policy(SCIM)(b)
          .withRawResponse(SCIM_ANSWER)
          .withDocs(handWrittenDocs(operations.createGroup)),
    )
    .registerRoute(
      "get",
      "/Groups/:id",
      MANAGEMENT_API_VERSION,
      async (c: Context, input: { id: string }) =>
        scimJson(
          c,
          await scim().getGroup({
            externalScimId: input.id,
            organizationId: organizationOf(c),
            excludeMembers: excludedMembers(c),
          }),
        ),
      (b) =>
        policy(SCIM)(b)
          .withParams(idParams)
          .withRawResponse(SCIM_ANSWER)
          .withDocs(handWrittenDocs(operations.getGroup)),
    )
    .registerRoute(
      "put",
      "/Groups/:id",
      MANAGEMENT_API_VERSION,
      async (c: Context, input: { id: string }) => {
        const body = await json(c);
        if (body === null) return scimError(c, 400, "Invalid JSON");
        const parsed = scimReplaceGroupRequestSchema.safeParse(body);
        if (!parsed.success) return scimError(c, 400, parsed.error.message);
        return scimJson(
          c,
          await scim().replaceGroup({
            externalScimId: input.id,
            organizationId: organizationOf(c),
            request: parsed.data,
          }),
        );
      },
      (b) =>
        policy(SCIM)(b)
          .withParams(idParams)
          .withRawResponse(SCIM_ANSWER)
          .withDocs(handWrittenDocs(operations.replaceGroup)),
    )
    .registerRoute(
      "patch",
      "/Groups/:id",
      MANAGEMENT_API_VERSION,
      async (c: Context, input: { id: string }) => {
        const body = await json(c);
        if (body === null) return scimError(c, 400, "Invalid JSON");
        const parsed = scimPatchRequestSchema.safeParse(body);
        if (!parsed.success) return scimError(c, 400, parsed.error.message);
        return scimJson(
          c,
          await scim().updateGroup({
            externalScimId: input.id,
            organizationId: organizationOf(c),
            patchRequest: parsed.data,
          }),
        );
      },
      (b) =>
        policy(SCIM)(b)
          .withParams(idParams)
          .withRawResponse(SCIM_ANSWER)
          .withDocs(handWrittenDocs(operations.patchGroup)),
    )
    .registerRoute(
      "delete",
      "/Groups/:id",
      MANAGEMENT_API_VERSION,
      async (c: Context, input: { id: string }) => {
        await scim().deleteGroup({
          externalScimId: input.id,
          organizationId: organizationOf(c),
        });
        return c.body(null, 204);
      },
      (b) =>
        policy(SCIM)(b)
          .withParams(idParams)
          .withRawResponse(SCIM_ANSWER)
          .withDocs(handWrittenDocs(operations.deleteGroup)),
    )
    .build();
}
