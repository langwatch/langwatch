/**
 * The OpenAPI document's producer.
 * `apps/api/src/features/discovery/openapi-document.json` is FROZEN: three routes serve
 * it, both SDKs generate clients from it, and this task never writes it.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { generateApiSpecs, normalizeExclusiveBounds } from "@langwatch/api/rest";
import { ORGANIZATIONS_SPEC_OPTIONS } from "@langwatch/organization-server";

import {
  allRegisteredRoutes,
  documentedPathOf,
  isHttpMethod,
  securityForCredentialClass,
  type CredentialClass,
} from "../../app-rest";
import {
  composeOpenApiDocumentSurface,
  type OpenApiSurfaceAbsence,
} from "./openapi-document.surface";

/**
 * Where the entry points write when nobody says. A build cache, deliberately. It is NOT a
 * default of {@link generateOpenApiDocument} — that function takes the path — so the only
 * way to write anywhere is to name it.
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

/**
 * An operation the mounted process serves and the public description cannot
 * express.
 */
export type UnpublishableOperation = Readonly<{
  /** `METHOD /path`. */
  operation: string;
  /** Why no client can satisfy it. */
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
  /** Families the surface could not describe, each with its reason. */
  absences: readonly OpenApiSurfaceAbsence[];
  /** Operations dropped because no security scheme can express them. */
  unpublishable: readonly UnpublishableOperation[];
  /**
   * `METHOD /documented/path` for every route the composed process registers, described
   * or not. Read off the mounted app's own router rather than from the generated
   * document, because they answer different questions.
   */
  servedRoutes: readonly string[];
}>;

/**
 * The document envelope: everything that is not a generated path. These fields were
 * hand-maintained inside the checked-in JSON and survived every run because the retired
 * generator merged the previous document back into the new one.
 */
const DOCUMENT_INFO = {
  title: "LangWatch API",
  version: "1.0.0",
  description: "LangWatch openapi spec",
} as const;

const DOCUMENT_SERVERS = [{ url: "https://app.langwatch.ai" }] as const;

/**
 * The document-wide default. Every operation the registry knows overrides it;
 * this is what an operation with no registered route would inherit, and
 * {@link stampSecurityFromRegistry} refuses to leave one on it.
 */
const DOCUMENT_SECURITY = [{ project_api_key: [] }] as const;

/**
 * The credential schemes the operations name.
 */
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
} as const;

/**
 * Schemas `project-openapi.rules.ts` and `api-key-openapi.rules.ts` reference by
 * a literal `$ref: "#/components/schemas/<name>"` rather than through a
 * `resolver()`-wrapped Zod schema — those two families were moved out of the
 * hand-maintained document with their operations reproduced verbatim, and
 * these three are the components their refs still point at. They stay
 * hand-maintained here for the same reason: nothing generates them.
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
      securitySchemes: {
        ...SECURITY_SCHEMES,
        ...ORGANIZATIONS_SPEC_OPTIONS.documentation?.components?.securitySchemes,
      },
      schemas: HAND_MAINTAINED_SCHEMAS,
    },
  };
}

/**
 * Describes the mounted surface and writes it where the caller said. The output path is a
 * REQUIRED decision of the caller's, not a default that happens to point at the artifact:
 * this task cannot be made to overwrite the frozen document by forgetting an argument.
 */
export async function generateOpenApiDocument({
  outputPath,
}: {
  outputPath: string;
}): Promise<GeneratedOpenApiDocument> {
  const surface = composeOpenApiDocumentSurface();

  const generated = (await generateApiSpecs(surface.app, {
    // Every RPC name a versioned family publishes is dotted and parameterless
    // (`/api/organization/organization.getSettings`), which the default filter
    // reads as a static file and drops. Pinned by `rpc-openapi.unit.test.ts`
    // in `@langwatch/api`.
    excludeStaticFile: false,
    documentation: documentEnvelope() as never,
  })) as unknown as OpenApiDocument;

  const stamped = normalizeExclusiveBounds(
    hoistEmbeddedJsonSchemaDefinitions(withoutEmptyPaths(generated)),
  );
  const unpublishable = stampSecurityFromRegistry(stamped);
  const document = atCanonicalPaths(withoutEmptyPaths(stamped));

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");

  return {
    document,
    outputPath,
    operations: operationKeysOf(document),
    absences: surface.absences,
    unpublishable,
    servedRoutes: registeredRouteKeys(surface.app),
  };
}

/**
 * Republishes every path at the `/api/v1` address the same route answers on, which is the
 * address the document names (ADR 002 §1).
 */
export function atCanonicalPaths(document: OpenApiDocument): OpenApiDocument {
  const paths = document.paths;
  if (!paths) return document;

  const canonical = new Map<string, string>();
  for (const route of allRegisteredRoutes()) {
    if (!route.canonicalPath) continue;
    canonical.set(documentedPathOf(route.path), documentedPathOf(route.canonicalPath));
  }

  const rewritten: Record<string, Record<string, unknown>> = {};
  for (const [routePath, item] of Object.entries(paths)) {
    const published = canonical.get(routePath) ?? routePath;
    if (rewritten[published]) {
      throw new Error(
        `${routePath} publishes at ${published}, which another path already claims. ` +
          "Two families cannot share one canonical address — opt one out of the v1 alias.",
      );
    }
    rewritten[published] = item;
  }

  return { ...document, paths: rewritten };
}

/** `METHOD /documented/path` for every route a composed app registers. */
function registeredRouteKeys(app: { routes: { method: string; path: string }[] }): string[] {
  return [
    ...new Set(app.routes.map((route) => `${route.method} ${documentedPathOf(route.path)}`)),
  ].sort();
}

/** `METHOD /path` for every operation a document describes, sorted. */
export function operationKeysOf(document: OpenApiDocument): string[] {
  return [...documentedOperations(document)].map(({ operationKey }) => operationKey).sort();
}

/**
 * Give every documented operation the security requirement its route actually enforces,
 * and DELETE the ones no requirement can express. The document declares one top-level
 * default, and a default is a claim about every operation that does not override it.
 */
export function stampSecurityFromRegistry(document: OpenApiDocument): UnpublishableOperation[] {
  const registry = indexRegistryByOperation();
  const unpublishable: UnpublishableOperation[] = [];

  for (const { routePath, method, operationKey, operation } of documentedOperations(document)) {
    const credentialClass =
      registry.byOperation.get(operationKey) ?? registry.byAnyMethodPath.get(routePath);
    if (!credentialClass) {
      // A family that declares its own `security` on the operation is not inheriting
      // anything, and that is the only failure this guards: the versioned secret family
      // states `project_api_key` at the service builder, so its routes carry a
      // requirement without appearing in the policy registry.
      if (declaresItsOwnSecurity(operation)) continue;
      throw new Error(
        `${operationKey} is generated from a mounted Hono app but matches no registered route, ` +
          `so it would inherit the document-wide security default. The documented path and ` +
          `the route path have to agree — check how the route spells its parameters.`,
      );
    }
    try {
      operation.security = securityForCredentialClass({ operationKey, credentialClass });
    } catch (error) {
      unpublishable.push({
        operation: operationKey,
        because: error instanceof Error ? error.message : String(error),
      });
      delete document.paths?.[routePath]?.[method];
    }
  }

  return unpublishable;
}

/** Whether the family already published a security requirement of its own. */
function declaresItsOwnSecurity(operation: { security?: unknown }): boolean {
  return Array.isArray(operation.security) && operation.security.length > 0;
}

/** Every operation object in the document, with the key the registry uses. */
function* documentedOperations(document: OpenApiDocument): Generator<{
  routePath: string;
  method: string;
  operationKey: string;
  operation: { security?: unknown };
}> {
  for (const [routePath, item] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of operationsOf(item)) {
      yield { routePath, method, operationKey: `${method.toUpperCase()} ${routePath}`, operation };
    }
  }
}

/**
 * The operation members of one Path Item. Filtered by method name rather than by value
 * shape: a Path Item also holds `servers` and `parameters`, both arrays, and an array is
 * an object to `typeof`.
 */
function operationsOf(item: Record<string, unknown>): Array<[string, { security?: unknown }]> {
  return Object.entries(item).filter(
    (entry): entry is [string, { security?: unknown }] =>
      isHttpMethod(entry[0]) && !!entry[1] && typeof entry[1] === "object",
  );
}

/**
 * The route registry keyed the way a document path is spelled.
 */
function indexRegistryByOperation(): {
  byOperation: Map<string, CredentialClass>;
  byAnyMethodPath: Map<string, CredentialClass>;
} {
  const byOperation = new Map<string, CredentialClass>();
  const byAnyMethodPath = new Map<string, CredentialClass>();
  for (const route of allRegisteredRoutes()) {
    const documented = documentedPathOf(route.path);
    if (route.method === "ALL") {
      byAnyMethodPath.set(documented, route.credentialClass);
      continue;
    }
    byOperation.set(`${route.method} ${documented}`, route.credentialClass);
  }
  return { byOperation, byAnyMethodPath };
}

/**
 * Drops path entries left holding no operation.
 */
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
 * Zod 4 emits local JSON Schema `$defs` for a recursive value (an arbitrary-JSON
 * field, for instance), SIBLING to a `$ref` that already points at
 * `#/components/schemas/<name>` — the two namespaces disagree, so the ref is
 * dangling until something moves the definition to where it points. OpenAPI
 * 3.1 does not define `$defs` either, so it cannot simply stay where it is:
 * this hoists every embedded `$defs` entry into the document's own
 * `components.schemas` (the ref's actual target) and then drops the
 * now-redundant local siblings.
 *
 * Two different local `$defs` wanting the SAME name is a real collision, not
 * something to resolve by picking one arbitrarily — this throws rather than
 * let the second silently clobber the first's callers.
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

/** `__schema0`, `__schema12`, ... — the placeholder names `@standard-community/
 * standard-openapi` gives a recursive schema it cannot otherwise name. */
const AUTO_GENERATED_SCHEMA_NAME = /^__schema\d+$/;

/**
 * Gives every auto-generated `__schemaN` entry a stable name instead: SDK
 * client code names this recursive JSON-value shape `JsonValue` directly
 * (`components["schemas"]["JsonValue"]`, and the generated-client patch script
 * that repairs its self-reference matches that name literally), so an
 * unstable counter would break both on every regeneration. Two DIFFERENT
 * auto-generated schemas in one run is a shape this generator has not seen
 * and does not know how to name distinctly — it throws rather than guess.
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

/** Strips every local `$defs` sibling, now that {@link collectEmbeddedJsonSchemaDefinitions}
 * has hoisted its content to `components.schemas`. */
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
