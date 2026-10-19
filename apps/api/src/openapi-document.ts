/**
 * The OpenAPI document, generated from the REST declarations every installed module carries and
 * never committed: the SDK and docs builds write it with `openapi:generate` before they read it
 * (specs/api-reference/openapi-document-generation.feature).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type { Authorize } from "@langwatch/api/access";
import { buildOpenApiDocument, type RestIdentity } from "@langwatch/api/hosting";
import { bindRestCredential, RestHost, type RestTransportDeclaration } from "@langwatch/api/rest";

import { processModules } from "./process-modules.generated.ts";

/** Where the SDK and docs builds read the generated document. Ignored by git. */
export const OPENAPI_DOCUMENT_PATH = "specs/api-reference/openapi-document.json";

const REPOSITORY_ROOT = join(import.meta.dirname, "../../..");

/** Describing a route answers no request, so every door and every middleware context refuses. */
function refuse(): never {
  throw new Error("the OpenAPI generator describes routes and answers no request");
}

const closed: RestIdentity = {
  authenticate: refuse,
  identify: refuse,
  identifyOptional: refuse,
  authorize: refuse,
  authorizePlatform: refuse,
};

const undecided: Authorize = {
  getDecision: refuse,
  getProjectAnyDecision: refuse,
  checkScopeLineage: refuse,
  organizationOf: refuse,
  getPlatformDecision: refuse,
  projectKindOf: refuse,
  authorization: refuse,
  assertSecondFactor: refuse,
};

type InstalledModule = Readonly<{
  transports?: readonly Readonly<{ protocol: string; router: () => unknown }>[] | undefined;
}>;

/** Every REST family the installed modules declare, in installation order. */
function restDeclarations(
  modules: readonly InstalledModule[],
): RestTransportDeclaration<unknown>[] {
  return modules.flatMap((module) =>
    (module.transports ?? [])
      .filter((transport) => transport.protocol === "rest")
      .map((transport) => transport.router() as RestTransportDeclaration<unknown>),
  );
}

/**
 * The REST application the api mounts, built from the declarations alone: no process boots,
 * no store opens, and a handler that ran would refuse.
 */
export function describedRestApplication(modules: readonly InstalledModule[] = processModules) {
  const declarations = restDeclarations(modules);
  const contexts = new Map<string, { middlewareContext: string; resolve: () => never }>();

  for (const declaration of declarations) {
    for (const route of declaration.routes) {
      for (const declared of route.middleware ?? []) {
        contexts.set(declared.name, { middlewareContext: declared.name, resolve: refuse });
      }
    }
  }

  const rest = RestHost.create({
    identities: {
      project: closed,
      organization: closed,
      api_key: closed,
      instance_admin: closed,
      browser: closed,
    },
    bearers: () => closed,
    audit: { record: async () => {} },
    idempotency: refuse,
    rateLimiter: { check: refuse },
    middlewareContext: [...contexts.values()] as never,
    entitlements: { holds: refuse },
    authz: undecided,
  });

  // A module binds these on a booted process; here every one is closed, as the host's are.
  const moduleDoors = (
    ["scim_token", "session_key", "cli_token", "otlp_ingest", "licence_token"] as const
  ).map((credential) => bindRestCredential(credential, () => closed));

  for (const declaration of declarations) {
    rest.mount(declaration, refuse, { middlewareBindings: moduleDoors });
  }

  return rest.app;
}

/** The document the api serves, generated from the installed declarations. */
export function generateOpenApiDocument(): Promise<Record<string, unknown>> {
  return buildOpenApiDocument(describedRestApplication());
}

/** Writes the document to `path` (relative to the repository root) and to nowhere else. */
export async function writeOpenApiDocument(path: string = OPENAPI_DOCUMENT_PATH): Promise<string> {
  const target = resolve(REPOSITORY_ROOT, path);
  const document = await generateOpenApiDocument();

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);

  return target;
}

if (import.meta.main) {
  const target = await writeOpenApiDocument(process.argv[2]);
  process.stdout.write(`Wrote ${target}\n`);
}
