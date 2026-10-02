/**
 * The OpenAPI document, generated from the REST declarations every installed module carries and
 * never committed: the SDK and docs builds write it with `openapi:generate` before they read it
 * (specs/api-reference/openapi-document-generation.feature).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { buildOpenApiDocument, type RestIdentity } from "@langwatch/api/hosting";
import { RestHost, type RestTransportDeclaration } from "@langwatch/api/rest";
import { processModules } from "@langwatch/installed-server-modules";

/** Where the SDK and docs builds read the generated document. Ignored by git. */
export const OPENAPI_DOCUMENT_PATH = "specs/api-reference/openapi-document.json";

const REPOSITORY_ROOT = join(import.meta.dirname, "../../..");

/** Describing a route answers no request, so every door and every fact refuses. */
function refuse(): never {
  throw new Error("the OpenAPI generator describes routes and answers no request");
}

const closed: RestIdentity = {
  authenticate: refuse,
  identify: refuse,
  identifyOptional: refuse,
  authorize: refuse,
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
  const facts = new Map<string, { middleware: { name: string }; resolve: () => never }>();

  for (const declaration of declarations) {
    for (const route of declaration.routes) {
      for (const fact of route.middleware ?? []) {
        facts.set(fact.name, { middleware: fact, resolve: refuse });
      }
    }
  }

  const rest = RestHost.create({
    identities: {
      project: closed,
      organization: closed,
      api_key: closed,
      scim_token: closed,
      instance_admin: closed,
      browser: closed,
    },
    bearers: () => closed,
    audit: { record: async () => {} },
    idempotency: refuse,
    rateLimiter: { check: refuse },
    facts: [...facts.values()] as never,
    entitlements: { holds: refuse },
  });

  for (const declaration of declarations) rest.mount(declaration, refuse);

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
