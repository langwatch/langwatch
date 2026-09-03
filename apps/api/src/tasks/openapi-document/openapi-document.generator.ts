/**
 * The OpenAPI document's producer.
 *
 * `apps/api/src/features/discovery/openapi-document.json` is FROZEN: three
 * routes serve it, both SDKs generate clients from it, and this task never
 * writes it. What this module does is describe the surface the process
 * actually mounts and put that description where the CALLER says. The output
 * path is a required argument rather than a defaulted one, so no run can
 * clobber the artifact by forgetting an argument; the two entry points fall
 * back to {@link DEFAULT_SCRATCH_PATH}, which is a build cache.
 *
 * ONE PASS over ONE app. The retired generator ran `generateSpecs` forty-eight
 * times, once per family, and deep-merged the results with a per-prefix
 * replace rule; that shape existed because the families were never mounted
 * together anywhere. They are now, so the merge, the prefix list and the prune
 * are all gone. What is left is the part that was load-bearing: the security
 * stamp, which reads each operation's credential class out of the route
 * registry rather than trusting a document-wide default.
 *
 * See `specs/api/openapi-document.feature`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { generateApiSpecs } from "@langwatch/api/rest";
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
 * Where the entry points write when nobody says.
 *
 * A build cache, deliberately. It is NOT a default of
 * {@link generateOpenApiDocument} — that function takes the path — so the
 * only way to write anywhere is to name it.
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
   * `METHOD /documented/path` for every route the composed process registers,
   * described or not.
   *
   * Read off the mounted app's own router rather than from the generated
   * document, because they answer different questions. The document says what
   * a family DESCRIBES; this says what the process SERVES. A route with no
   * `describeRoute` is served and undescribed, and telling the two apart is
   * what keeps the frozen document's hand-maintained entries from reading as
   * routes that were deleted.
   */
  servedRoutes: readonly string[];
}>;

/**
 * The document envelope: everything that is not a generated path.
 *
 * These fields were hand-maintained inside the checked-in JSON and survived
 * every run because the retired generator merged the previous document back
 * into the new one. With the merge gone they need a home, and the producer is
 * it — a value in the code that writes the document, rather than a value that
 * only exists because the last run happened to carry it forward.
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
 *
 * `instance_admin_key` is imported from the family that authenticates with it,
 * because a security requirement naming a scheme the document never declares
 * does not degrade: the reference renders an operation nobody can
 * authenticate, and a client generator resolving
 * `#/components/securitySchemes/...` finds nothing there.
 *
 * `scim_bearer` is written out here rather than imported from
 * `@langwatch/enterprise-scim-server`, which this application does not depend
 * on — it mounts no SCIM 2.0 family, which is one of the surface's named
 * absences. The scheme stays because `scim_token` is a credential class the
 * registry can still return, and a stamped operation naming a scheme the
 * document omits is the exact failure the import above exists to prevent.
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
    },
  };
}

/**
 * Describes the mounted surface and writes it where the caller said.
 *
 * The output path is a REQUIRED decision of the caller's, not a default that
 * happens to point at the artifact: this task cannot be made to overwrite the
 * frozen document by forgetting an argument.
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

  const stamped = withoutEmbeddedJsonSchemaDefinitions(withoutEmptyPaths(generated));
  const unpublishable = stampSecurityFromRegistry(stamped);
  const document = withoutEmptyPaths(stamped);

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
 * Give every documented operation the security requirement its route actually
 * enforces, and DELETE the ones no requirement can express.
 *
 * The document declares one top-level default, and a default is a claim about
 * every operation that does not override it. That claim was `project_api_key`
 * for the whole API, including the organization-scoped spend and webhook
 * routes a project key can never reach: an integrator following the document
 * got a 401 the document said was impossible.
 *
 * Read from the route registry rather than written per route, so an operation
 * cannot publish a credential class nothing enforces, and a route added
 * tomorrow is stamped without anyone remembering to.
 *
 * A route reaching by `session` or `internal` has no scheme a consumer of the
 * public API holds, and `securityForCredentialClass` refuses to invent one.
 * The two honest answers it names are to give the document a scheme or to keep
 * the operation out; this takes the second and RETURNS the operation so the
 * caller can say which routes carry a `describeRoute` the description cannot
 * honour. Writing an empty requirement — the dishonest third — would make
 * every generated client emit an unauthenticated call.
 */
export function stampSecurityFromRegistry(document: OpenApiDocument): UnpublishableOperation[] {
  const registry = indexRegistryByOperation();
  const unpublishable: UnpublishableOperation[] = [];

  for (const { routePath, method, operationKey, operation } of documentedOperations(document)) {
    const credentialClass =
      registry.byOperation.get(operationKey) ?? registry.byAnyMethodPath.get(routePath);
    if (!credentialClass) {
      // A family that declares its own `security` on the operation is not
      // inheriting anything, and that is the only failure this guards: the
      // versioned secret family states `project_api_key` at the service
      // builder, so its routes carry a requirement without appearing in the
      // policy registry. An operation with NEITHER would silently publish the
      // document-wide default, which is the bug per-operation stamping exists
      // to prevent, so that one fails the run.
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
 * The operation members of one Path Item.
 *
 * Filtered by method name rather than by value shape: a Path Item also holds
 * `servers` and `parameters`, both arrays, and an array is an object to
 * `typeof`. Stamping `security` onto `servers` produces a document that no
 * longer validates.
 */
function operationsOf(item: Record<string, unknown>): Array<[string, { security?: unknown }]> {
  return Object.entries(item).filter(
    (entry): entry is [string, { security?: unknown }] =>
      isHttpMethod(entry[0]) && !!entry[1] && typeof entry[1] === "object",
  );
}

/**
 * The route registry keyed the way a document path is spelled.
 *
 * Any-method routes are kept in their own index rather than expanded into
 * verbs, so a specific registration on the same path still wins, and so a
 * documented verb of an `.all(...)` route is stamped rather than left
 * inheriting the document default, which is the one outcome the stamping
 * exists to prevent.
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
 *
 * `describeRoute({ hide: true })` removes the operation but keeps its path key,
 * so a hidden route leaves `"/api/experiments/execute": {}` behind — an entry
 * that documents nothing and reads, to anything scanning the document, as a
 * path we publish.
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
 * Zod 4 emits local JSON Schema `$defs` alongside the component references it
 * has already resolved. OpenAPI 3.1 does not define `$defs`; leaving it in a
 * schema makes client generators treat it as a required data property. The
 * local definitions are redundant here — all emitted references already point
 * at `#/components/schemas/*` — so remove them from the published document.
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
