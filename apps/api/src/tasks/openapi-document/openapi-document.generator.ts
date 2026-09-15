/**
 * The OpenAPI document's producer.
 *
 * It reads the installed module declarations and writes what they publish.
 * `apps/api/src/features/discovery/openapi-document.json` is FROZEN: three
 * routes serve it, both SDKs generate clients from it, and this task never
 * writes it.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  generateApiSpecs,
  isHttpMethod,
  normalizeExclusiveBounds,
  securityForCredentialClass,
} from "@langwatch/api/rest";

import type { DeclaredRestFamily } from "./openapi-document.declarations.ts";
import {
  composeOpenApiDocumentSurface,
  type AccessPolicyExtension,
  type DeclaredOperation,
} from "./openapi-document.surface.ts";

/**
 * Where the entry points write when nobody says. A build cache, deliberately.
 * It is NOT a default of {@link generateOpenApiDocument} — that function takes
 * the path — so the only way to write anywhere is to name it.
 */
export const DEFAULT_SCRATCH_PATH = "node_modules/.cache/openapi/served-openapi-document.json";

/** The eight OpenAPI operation members of a Path Item. */
const OPENAPI_METHODS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
  "trace",
] as const;

/** The document, as far as anything here reads it. */
export type OpenApiDocument = {
  paths?: Record<string, Record<string, unknown>> | undefined;
  [key: string]: unknown;
};

/** An operation the declarations publish that no security scheme can express. */
export type UnpublishableOperation = Readonly<{
  /** `METHOD /path`. */
  operation: string;
  /** Why no client can satisfy it. */
  because: string;
}>;

/** A declared route the document does not describe, and what it declared. */
export type UndescribedRoute = Readonly<{
  /** `METHOD /path`. */
  operation: string;
  /** The family that declared it. */
  family: string;
  /** Why the declaration keeps it out. */
  because: string;
}>;

/** What one generation run produced. */
export type GeneratedOpenApiDocument = Readonly<{
  /** The document itself. */
  document: OpenApiDocument;
  /** Where it was written. */
  outputPath: string;
  /** `METHOD /path` for every operation it describes, sorted. */
  operations: readonly string[];
  /** How many families and declared routes the declarations named. */
  counts: Readonly<{ families: number; routes: number }>;
  /** Operations dropped because no security scheme can express them. */
  unpublishable: readonly UndescribedRoute[];
  /** Routes whose own declaration keeps them out of the document. */
  undescribed: readonly UndescribedRoute[];
  /** `METHOD /path` for every address a declared route answers at, sorted. */
  declaredRoutes: readonly string[];
}>;

/**
 * The document envelope: everything that is not a generated path. These fields
 * are hand-maintained, because nothing generates them.
 */
const DOCUMENT_INFO = {
  title: "LangWatch API",
  version: "1.0.0",
  description: "LangWatch openapi spec",
} as const;

const DOCUMENT_SERVERS = [{ url: "https://app.langwatch.ai" }] as const;

/**
 * The document-wide default. Every operation the declarations know overrides
 * it; this is what an operation with no declaration would inherit, and
 * {@link stampAccessFromDeclarations} refuses to leave one on it.
 */
const DOCUMENT_SECURITY = [{ project_api_key: [] }] as const;

/** The credential schemes the operations name. */
const SECURITY_SCHEMES = {
  project_api_key: {
    type: "apiKey",
    in: "header",
    name: "X-Auth-Token",
    description:
      "Project API key for sending traces and accessing project-scoped resources. Format: sk-lw-... (no underscore). Obtain one by creating a project via the Admin API or the LangWatch UI.",
  },
  admin_api_key: {
    type: "http",
    scheme: "bearer",
    description:
      "Admin API key for organization-level operations (managing projects, API keys). Create one in Settings > API Keys or via POST /api/api-keys. Format: sk-lw-{id}_{secret}.",
  },
  scim_bearer: {
    type: "http",
    scheme: "bearer",
    description:
      "SCIM token for one organization's directory connection, created with POST /api/scim-tokens or in Settings > SCIM. It authenticates provisioning calls only, and stops working if the organization's Enterprise plan lapses.",
  },
  instance_admin_key: {
    type: "http",
    scheme: "bearer",
    description:
      "Instance administrator key, set as LANGWATCH_INSTANCE_ADMIN_API_KEY on a self-hosted deployment. It exists to create the first organization, before any organization key does; every other management API takes an organization key instead.",
  },
  internal_secret: {
    type: "http",
    scheme: "bearer",
    description:
      "The deployment's own shared secret, presented by another LangWatch service rather than by a customer. The families behind it are ingress-blocked; they are described so a self-hosted operator can see what the deployment talks to itself about.",
  },
} as const;

/**
 * Schemas the prompt and API-key families reference by a literal
 * `$ref: "#/components/schemas/<name>"` rather than through a `resolver()`-
 * wrapped zod schema. They stay hand-maintained here because nothing
 * generates them.
 */
const HAND_MAINTAINED_SCHEMAS = {
  Project: {
    type: "object",
    properties: {
      id: { type: "string", description: "Project ID (project_...)" },
      name: { type: "string" },
      slug: { type: "string" },
      language: { type: "string" },
      framework: { type: "string" },
      teamId: { type: "string" },
      piiRedactionLevel: { type: "string", enum: ["STRICT", "ESSENTIAL", "DISABLED"] },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
    },
  },
  Pagination: {
    type: "object",
    properties: {
      page: { type: "integer" },
      limit: { type: "integer" },
      total: { type: "integer" },
    },
  },
  ApiKeyInfo: {
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      description: { type: "string", nullable: true },
      createdAt: { type: "string", format: "date-time" },
      expiresAt: { type: "string", format: "date-time", nullable: true },
      lastUsedAt: { type: "string", format: "date-time", nullable: true },
      revokedAt: { type: "string", format: "date-time", nullable: true },
      roleBindings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            role: { type: "string", enum: ["ADMIN", "MEMBER", "VIEWER"] },
            scopeType: { type: "string", enum: ["ORGANIZATION", "TEAM", "PROJECT"] },
            scopeId: { type: "string" },
          },
        },
      },
    },
  },
} as const;

/** The `documentation` hono-openapi merges over the generated paths. */
function documentEnvelope(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: DOCUMENT_INFO,
    servers: DOCUMENT_SERVERS,
    security: DOCUMENT_SECURITY,
    components: {
      securitySchemes: SECURITY_SCHEMES,
      schemas: HAND_MAINTAINED_SCHEMAS,
    },
  };
}

/**
 * Describes every installed declaration and writes it where the caller said.
 * The output path is a REQUIRED decision of the caller's, not a default that
 * happens to point at the artifact: this task cannot be made to overwrite the
 * frozen document by forgetting an argument.
 */
export async function generateOpenApiDocument({
  outputPath,
  families,
}: {
  outputPath: string;
  /**
   * The families to describe. Handed in rather than read here, so nothing on
   * this path imports the installed module graph: the task is the one place
   * that asks what this build installs.
   */
  families: readonly DeclaredRestFamily[];
}): Promise<GeneratedOpenApiDocument> {
  const surface = composeOpenApiDocumentSurface({ families });

  const generated = (await generateApiSpecs(surface.app, {
    // Every RPC name a versioned family publishes is dotted and parameterless
    // (`/api/organization/organization.getSettings`), which the default filter
    // reads as a static file and drops.
    excludeStaticFile: false,
    documentation: documentEnvelope() as never,
  })) as unknown as OpenApiDocument;

  const stamped = normalizeExclusiveBounds(
    hoistEmbeddedJsonSchemaDefinitions(withoutEmptyPaths(generated)),
  );
  const unpublishable = stampAccessFromDeclarations({
    document: stamped,
    declared: surface.operations,
  });
  const document = withUnstatedBodiesLeftUnstated(withoutEmptyPaths(stamped));
  const operations = operationKeysOf(document);

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");

  return {
    document,
    outputPath,
    operations,
    counts: surface.counts,
    unpublishable,
    undescribed: undescribedRoutes({ declared: surface.operations, operations }),
    declaredRoutes: [...new Set(surface.operations.map(({ operationKey }) => operationKey))].sort(),
  };
}

/** Every declared operation the finished document does not describe. */
function undescribedRoutes({
  declared,
  operations,
}: {
  declared: readonly DeclaredOperation[];
  operations: readonly string[];
}): UndescribedRoute[] {
  const described = new Set(operations);

  return declared
    .filter((operation) => !described.has(operation.operationKey))
    .map((operation) => ({
      operation: operation.operationKey,
      family: operation.family,
      because: operation.published
        ? "no security scheme can express the credential its declaration names"
        : "its declaration hides it from the published document",
    }))
    .sort((left, right) => left.operation.localeCompare(right.operation));
}

/** `METHOD /path` for every operation a document describes, sorted. */
export function operationKeysOf(document: OpenApiDocument): string[] {
  return [...documentedOperations(document)].map(({ operationKey }) => operationKey).sort();
}

/**
 * Give every documented operation the security requirement its declaration
 * enforces and the access policy it states, and DELETE the ones no requirement
 * can express. The document declares one top-level default, and a default is a
 * claim about every operation that does not override it; the policy beside it
 * says what that credential has to hold.
 */
export function stampAccessFromDeclarations({
  document,
  declared,
}: {
  document: OpenApiDocument;
  declared: readonly DeclaredOperation[];
}): UndescribedRoute[] {
  const byOperation = new Map(declared.map((operation) => [operation.operationKey, operation]));
  const unpublishable: UndescribedRoute[] = [];

  for (const { routePath, method, operationKey, operation } of documentedOperations(document)) {
    const route = byOperation.get(operationKey);

    if (!route) {
      throw new Error(
        `${operationKey} is described by the generated document and matches no declared route, ` +
          "so it would inherit the document-wide security default. Every operation in the " +
          "document comes from a declaration — check how the route spells its parameters.",
      );
    }

    try {
      operation.security = securityForCredentialClass({
        operationKey,
        credentialClass: route.credentialClass,
      });
    } catch (error) {
      unpublishable.push({
        operation: operationKey,
        family: route.family,
        because: error instanceof Error ? error.message : String(error),
      });
      delete document.paths?.[routePath]?.[method];
      continue;
    }

    operation["x-access-policy"] = route.accessPolicy;
  }

  return unpublishable;
}

/** Every operation object in the document, with the key the declarations use. */
function* documentedOperations(document: OpenApiDocument): Generator<{
  routePath: string;
  method: string;
  operationKey: string;
  operation: { security?: unknown; "x-access-policy"?: AccessPolicyExtension };
}> {
  for (const [routePath, item] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of operationsOf(item)) {
      yield { routePath, method, operationKey: `${method.toUpperCase()} ${routePath}`, operation };
    }
  }
}

/**
 * The operation members of one Path Item. Filtered by method name rather than
 * by value shape: a Path Item also holds `servers` and `parameters`, both
 * arrays, and an array is an object to `typeof`.
 */
function operationsOf(
  item: Record<string, unknown>,
): Array<[string, { security?: unknown; "x-access-policy"?: AccessPolicyExtension }]> {
  return Object.entries(item).filter(
    (entry): entry is [string, { security?: unknown; "x-access-policy"?: AccessPolicyExtension }] =>
      isHttpMethod(entry[0]) && !!entry[1] && typeof entry[1] === "object",
  );
}

/** Drops path entries left holding no operation. */
function withoutEmptyPaths(document: OpenApiDocument): OpenApiDocument {
  const paths = document.paths;

  if (!paths) return document;

  return {
    ...document,
    paths: Object.fromEntries(
      Object.entries(paths).filter(([, item]) =>
        OPENAPI_METHODS.some((method) => item?.[method] !== undefined),
      ),
    ),
  };
}

/**
 * Zod 4 emits local JSON Schema `$defs` for a recursive value, sibling to a
 * `$ref` that already points at `#/components/schemas/<name>` — the ref is
 * dangling until this hoists the `$defs` entry there and drops the local
 * sibling. Two local `$defs` wanting the same name is a real collision, so
 * this throws rather than let the second silently clobber the first's callers.
 */
function hoistEmbeddedJsonSchemaDefinitions(document: OpenApiDocument): OpenApiDocument {
  const hoisted: Record<string, unknown> = {};

  collectEmbeddedJsonSchemaDefinitions(document.paths, hoisted);

  const { renamed, renames } = renameAutoGeneratedJsonSchemaDefinitions(hoisted);
  const strippedPaths = withoutEmbeddedJsonSchemaDefinitions(document.paths);
  const paths = renames.size > 0 ? renameSchemaRefs(strippedPaths, renames) : strippedPaths;
  // A recursive schema's own body $refs its OLD name (an array or record of
  // itself), so the rename has to reach into the hoisted definitions too —
  // not just the paths that reference them from outside.
  const schemas = renames.size > 0 ? renameSchemaRefs(renamed, renames) : renamed;

  return {
    ...document,
    paths,
    components: {
      ...(document.components as Record<string, unknown> | undefined),
      schemas: {
        ...((document.components as { schemas?: Record<string, unknown> } | undefined)?.schemas ??
          {}),
        ...schemas,
      },
    },
  };
}

/**
 * `__schema0`, `__schema12`, ... — the placeholder names
 * `@standard-community/standard-openapi` gives a recursive schema it cannot
 * otherwise name.
 */
const AUTO_GENERATED_SCHEMA_NAME = /^__schema\d+$/;

/**
 * Gives every auto-generated `__schemaN` entry a stable name: SDK client code
 * and the generated-client patch script both name this shape `JsonValue`
 * literally, so an unstable counter would break both on regeneration. Two
 * different auto-generated schemas in one run is unhandled — throws rather
 * than guess a name.
 */
function renameAutoGeneratedJsonSchemaDefinitions(hoisted: Record<string, unknown>): {
  renamed: Record<string, unknown>;
  renames: Map<string, string>;
} {
  const autoNamed = Object.keys(hoisted).filter((name) => AUTO_GENERATED_SCHEMA_NAME.test(name));

  if (autoNamed.length === 0) return { renamed: hoisted, renames: new Map() };

  if (autoNamed.length > 1) {
    throw new Error(
      `${autoNamed.length} auto-generated recursive schemas (${autoNamed.join(", ")}) hoisted ` +
        "in one run; renameAutoGeneratedJsonSchemaDefinitions only knows how to rename a single " +
        "one to JsonValue. Give it a real name at the source instead of guessing here.",
    );
  }

  const [autoName] = autoNamed;

  if (Object.hasOwn(hoisted, "JsonValue") && autoName) {
    throw new Error(
      `Both an explicit JsonValue schema and an auto-generated ${autoName} were hoisted; ` +
        "they need to be the same schema under one name, not two.",
    );
  }

  const renames = new Map([[autoName as string, "JsonValue"]]);
  const renamed = Object.fromEntries(
    Object.entries(hoisted).map(([name, def]) => [renames.get(name) ?? name, def]),
  );

  return { renamed, renames };
}

/** Rewrites every `$ref` in `value` naming an old schema name to its new one. */
function renameSchemaRefs<T>(value: T, renames: Map<string, string>): T {
  if (Array.isArray(value)) {
    return value.map((item) => renameSchemaRefs(item, renames)) as T;
  }

  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (key === "$ref" && typeof item === "string") {
        const name = item.split("/").pop();
        const renamedTo = name ? renames.get(name) : undefined;

        return [key, renamedTo ? `#/components/schemas/${renamedTo}` : item];
      }

      return [key, renameSchemaRefs(item, renames)];
    }),
  ) as T;
}

/** Walks `value`, hoisting every `$defs` entry it finds into `hoisted`. */
function collectEmbeddedJsonSchemaDefinitions(
  value: unknown,
  hoisted: Record<string, unknown>,
): void {
  if (Array.isArray(value)) {
    for (const item of value) collectEmbeddedJsonSchemaDefinitions(item, hoisted);

    return;
  }

  if (!value || typeof value !== "object") return;

  const defs = (value as { $defs?: unknown }).$defs;

  if (defs && typeof defs === "object") {
    for (const [name, definition] of Object.entries(defs as Record<string, unknown>)) {
      if (
        Object.hasOwn(hoisted, name) &&
        JSON.stringify(hoisted[name]) !== JSON.stringify(definition)
      ) {
        throw new Error(
          `Two different schemas both embed $defs.${name} with different content; hoisting ` +
            "both to components.schemas would silently pick one over the other.",
        );
      }

      hoisted[name] = definition;
    }
  }

  for (const [key, item] of Object.entries(value)) {
    if (key === "$defs") continue;

    collectEmbeddedJsonSchemaDefinitions(item, hoisted);
  }
}

/**
 * Strips every local `$defs` sibling, now that
 * {@link collectEmbeddedJsonSchemaDefinitions} has hoisted its content to
 * `components.schemas`.
 */
function withoutEmbeddedJsonSchemaDefinitions<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(withoutEmbeddedJsonSchemaDefinitions) as T;
  }

  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "$defs")
      .map(([key, item]) => [key, withoutEmbeddedJsonSchemaDefinitions(item)]),
  ) as T;
}

/** A media object as far as this pass reads it: the schema is what it looks for. */
type MediaObject = { schema?: unknown };

/** Whether a `content` map states a schema for at least one media type. */
function statesASchema(content: Record<string, MediaObject> | undefined): boolean {
  return Object.values(content ?? {}).some(
    (media) => !!media && typeof media === "object" && media.schema !== undefined,
  );
}

/**
 * A media object naming a media type and no schema is what `withRawBody` /
 * `withRawResponse` leave behind for an undescribed shape, never something a
 * route stated. A response loses that schema-less entry; a request body keeps
 * its media type but stops claiming `required: true` (the middleware's blanket
 * default) — a required body of unstated shape satisfies no reader.
 */
export function withUnstatedBodiesLeftUnstated(document: OpenApiDocument): OpenApiDocument {
  for (const [, item] of Object.entries(document.paths ?? {})) {
    for (const [, operation] of operationsOf(item)) {
      const op = operation as {
        requestBody?: { required?: boolean; content?: Record<string, MediaObject> };
        responses?: Record<string, { content?: Record<string, MediaObject> }>;
      };

      if (op.requestBody?.content && !statesASchema(op.requestBody.content)) {
        op.requestBody.required = false;
      }

      for (const response of Object.values(op.responses ?? {})) {
        if (!response?.content) continue;

        const described = Object.fromEntries(
          Object.entries(response.content).filter(
            ([, media]) => !!media && typeof media === "object" && media.schema !== undefined,
          ),
        );

        if (Object.keys(described).length === Object.keys(response.content).length) continue;

        if (Object.keys(described).length === 0) delete response.content;
        else response.content = described;
      }
    }
  }

  return document;
}
