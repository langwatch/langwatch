/**
 * The REST surface as the installed declarations state it, composed for
 * description rather than for service.
 *
 * Every route is registered on one Hono app carrying nothing but its OpenAPI
 * block and its validators — no runtime, no door, no handler. The app exists
 * because hono-openapi reads a route's input schemas back off the middleware
 * it attached them to, and that metadata is what turns a zod schema into JSON
 * Schema. Nothing here resolves a member, opens a client or serves a request.
 *
 * ONE ADDRESS PER ROUTE. A dated family answers the same operation at three
 * addresses — `/2026-08-07/x`, `/latest/x` and `/x` — and each is the same
 * call reached through a different version selector. OpenAPI has no way to say
 * that, so publishing all three would give a client generator three names for
 * one operation and treble the document. The published address is the bare
 * one, at its `/api/v1` twin where the family has one (ADR 002 §1), which is
 * the address a client is told to call; the version is negotiated with the
 * `X-API-Version` header the document describes once.
 */
import {
  basePathOf,
  canonicalV1Path,
  CREDENTIAL_CLASS_BY_DOOR,
  documentedPathOf,
  permissionOf,
  restRouteDocumentation,
  validator,
  type RestTransportDeclaration,
  type RestTransportRoute,
} from "@langwatch/api/rest";
import type { CredentialClass } from "@langwatch/api";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { mergePath } from "hono/utils/url";
import { describeRoute } from "hono-openapi";

import type { DeclaredRestFamily } from "./openapi-document.declarations.ts";

/**
 * The declared access decision, as an operation publishes it. Structured
 * members only: a policy's prose is about how a handler is built, and stays
 * out of a document a customer reads.
 */
export type AccessPolicyExtension = Readonly<{
  /** Which policy kind the declaration states. */
  kind: "public" | "handlerManaged";
  /** Every credential class a caller may present to reach the operation. */
  credential: readonly CredentialClass[];
  /** What the route enforces itself; `[]` where the door alone gates it. */
  permissions?: readonly string[];
}>;

/** One operation a declared route publishes, and what it publishes it behind. */
export type DeclaredOperation = Readonly<{
  /** `GET /api/v1/annotations/{id}`, the key the document is stamped by. */
  operationKey: string;
  /** The document path, with `{id}` where the route writes `:id`. */
  path: string;
  /** The HTTP method, lower-cased the way a Path Item member is spelled. */
  method: string;
  /** The family's namespace, for a diagnostic. */
  family: string;
  /** The module that installed the family. */
  module: string;
  /** The scheme a consumer of this operation presents. */
  credentialClass: CredentialClass;
  /** The access decision, as `x-access-policy`. */
  accessPolicy: AccessPolicyExtension;
  /** False for a route whose declaration keeps it out of the document. */
  published: boolean;
}>;

/** The described surface, and the declarations it was built from. */
export type OpenApiDocumentSurface = Readonly<{
  /** Every describable route, in ONE app, described and never served. */
  app: Hono;
  /** Every operation the declarations publish, keyed the document's way. */
  operations: readonly DeclaredOperation[];
  /** How many families and declared routes the surface read. */
  counts: Readonly<{ families: number; routes: number }>;
}>;

/**
 * A route whose declaration says it publishes no operation. Neither is a hole:
 * an any-method route has no single operation to name, and a family behind a
 * browser session can be called by no API client, so an advertised operation
 * would be one nothing can satisfy.
 */
function publishable({
  route,
  declaration,
}: {
  route: RestTransportRoute<unknown>;
  declaration: RestTransportDeclaration<unknown>;
}): boolean {
  return route.anyMethod !== true && declaration.credential !== "browser";
}

/** The address the document publishes one route at. */
export function publishedPathOf({
  route,
  declaration,
}: {
  route: RestTransportRoute<unknown>;
  declaration: RestTransportDeclaration<unknown>;
}): string {
  const base = basePathOf(declaration);
  // A collection route's path is the family root, so it contributes no
  // suffix: concatenating it would address the namespace as `/`.
  const suffix = route.path === "/" ? "" : route.path;
  const path = suffix || "/";
  // A literal family has no base to merge onto: its route path IS the address.
  const absolute = base === "" ? path : mergePath(base, path);
  const alias = declaration.v1Twin ? canonicalV1Path(absolute) : null;

  return documentedPathOf(alias ?? absolute);
}

/** The scheme a consumer of one declared route presents. */
function credentialClassOf({
  route,
  declaration,
}: {
  route: RestTransportRoute<unknown>;
  declaration: RestTransportDeclaration<unknown>;
}): CredentialClass {
  if (route.access?.kind === "public") return "none";

  return CREDENTIAL_CLASS_BY_DOOR[route.credential ?? declaration.credential];
}

/** The access decision one declared route publishes. */
function accessPolicyOf({
  route,
  credentialClass,
}: {
  route: RestTransportRoute<unknown>;
  credentialClass: CredentialClass;
}): AccessPolicyExtension {
  if (route.access?.kind === "public") return { kind: "public", credential: ["none"] };

  return {
    kind: "handlerManaged",
    credential: [credentialClass],
    // A route that declares access instead of a permission enforces no RBAC
    // permission, which is what the empty list states.
    permissions: route.access ? [] : [permissionOf(route.permission)],
  };
}

/** The describe-and-validate stack one route publishes its operation through. */
function descriptionStack({
  route,
  declaration,
}: {
  route: RestTransportRoute<unknown>;
  declaration: RestTransportDeclaration<unknown>;
}): MiddlewareHandler[] {
  const deprecated = route.deprecated ?? declaration.deprecated;
  const stack: MiddlewareHandler[] = [
    describeRoute(
      restRouteDocumentation({
        route,
        credential: declaration.credential,
        ...(deprecated ? { deprecated } : {}),
      }),
    ),
  ];

  // The validators are here for their metadata alone: hono-openapi hangs the
  // route's input schema off the middleware, and reading it back is what
  // publishes the parameters and the request body.
  if (route.params) stack.push(validator("param", route.params));

  if (route.query) stack.push(validator("query", route.query));

  if (route.input) stack.push(validator("json", route.input));

  return stack;
}

/**
 * Two declarations claim one published address. Refused rather than let the
 * second silently overwrite the first, which reads in a document diff as the
 * first one's whole operation having been deleted.
 */
export class DuplicatePublishedAddressError extends Error {
  constructor(
    readonly operationKey: string,
    readonly claimants: readonly string[],
  ) {
    super(
      `${operationKey} is published by more than one declaration (${claimants.join(", ")}). ` +
        "Two families cannot share one address — give one its own namespace, or opt it out of " +
        "the /api/v1 twin.",
    );
    this.name = "DuplicatePublishedAddressError";
  }
}

/**
 * Describes the families it is handed, and never serves one. What is installed
 * is the generator's question, asked once through `declaredRestFamilies`; this
 * describes whatever it is given, so describing a family costs nothing but the
 * declaration itself.
 */
export function composeOpenApiDocumentSurface({
  families,
}: {
  families: readonly DeclaredRestFamily[];
}): OpenApiDocumentSurface {
  const app = new Hono();
  const operations: DeclaredOperation[] = [];
  const claimed = new Map<string, string>();
  let routes = 0;

  for (const { module, declaration } of families) {
    for (const route of declaration.routes) {
      routes += 1;

      if (!publishable({ route, declaration })) continue;

      const path = publishedPathOf({ route, declaration });
      const credentialClass = credentialClassOf({ route, declaration });
      const stack = descriptionStack({ route, declaration });

      for (const method of route.methods ?? [route.method]) {
        const operationKey = `${method.toUpperCase()} ${path}`;
        const owner = claimed.get(operationKey);
        const claimant = `${module}/${declaration.namespace}`;

        // Any repeat, including one inside a single declaration: a document
        // holds one operation per method and path, so a second claim is a
        // route nobody will ever read about.
        if (owner !== undefined) {
          throw new DuplicatePublishedAddressError(operationKey, [owner, claimant]);
        }

        claimed.set(operationKey, claimant);
        app.on([method], [path], ...stack, unreachable);
        operations.push({
          operationKey,
          path,
          method,
          family: declaration.namespace,
          module,
          credentialClass,
          accessPolicy: accessPolicyOf({ route, credentialClass }),
          published: route.docs?.hide !== true,
        });
      }
    }
  }

  return { app, operations, counts: { families: families.length, routes } };
}

/**
 * The terminal handler every described route carries. Hono needs one; nothing
 * dispatches this app, so reaching it means something served the description
 * surface, which is a wiring bug worth a stack trace rather than a response.
 */
const unreachable: MiddlewareHandler = () => {
  throw new Error("The OpenAPI description surface answers no request.");
};
