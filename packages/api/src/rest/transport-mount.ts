import { actorSchema, type Actor } from "@langwatch/actor";
import {
  declaredScopeIdSchema,
  type AuthzDeclaredScopeId,
  type AuthzPermission,
} from "@langwatch/authz-contract";
import type { Context, MiddlewareHandler } from "hono";
import { z } from "zod";
import { bodyLimit } from "./body-limit.ts";

import { handlerManagedAuth, type HandlerCredential } from "../access-policy.ts";
import type { RestApiVersionedFamily } from "./security/rest-api-service.ts";
import type { RestTransportDeclaration, RestTransportRoute } from "./rest-router.ts";
import type {
  RestTransportMiddleware,
  RestTransportMiddlewareBinding,
} from "./transport-middleware.ts";

const TRANSPORT_AUTHORIZATION = "__langwatch_transport_authorization" as const;
type ProjectScope = Extract<AuthzDeclaredScopeId, { tier: "project" }>;

export type ProjectTransportAuthorization = Readonly<{
  readonly actor: Actor | null;
  readonly scope: ProjectScope;
}>;

export type ProjectTransportMount<Api> = Readonly<{
  readonly family: RestApiVersionedFamily;
  readonly transport: RestTransportDeclaration<Api>;
  readonly app: () => Api;
  readonly credential: HandlerCredential;
  readonly authenticate: (input: { permission: AuthzPermission }) => MiddlewareHandler;
  readonly authorize: (args: {
    permission: AuthzPermission;
    input: unknown;
    authorization: ProjectTransportAuthorization;
  }) => void | Promise<void>;
  /** Runs only after the descriptor handler has completed successfully. */
  readonly afterSuccess?: (args: {
    context: Context;
    input: unknown;
    authorization: ProjectTransportAuthorization;
  }) => void | Promise<void>;
  readonly middleware?: readonly RestTransportMiddlewareBinding[];
}>;

/** Records host-verified facts for the framework adapter to pass to a descriptor handler. */
export function setProjectTransportAuthorization(
  context: Context,
  facts: ProjectTransportAuthorization,
): void {
  context.set(TRANSPORT_AUTHORIZATION, facts);
}

/** Registers an inert feature declaration through the established project REST family. */
export function mountProjectTransport<Api>({
  family,
  transport,
  app,
  credential,
  authenticate,
  authorize,
  afterSuccess,
  middleware = [],
}: ProjectTransportMount<Api>): void {
  for (const route of transport.routes) {
    mountRoute({
      family,
      route,
      app,
      credential,
      authenticate,
      authorize,
      afterSuccess,
      middleware,
    });
  }
}

/** Uses the project's existing authentication and permission middleware. */
export function mountAuthenticatedProjectTransport<Api>(options: {
  family: RestApiVersionedFamily;
  transport: RestTransportDeclaration<Api>;
  app: () => Api;
  authorization(context: Context): ProjectTransportAuthorization;
  middleware?: readonly RestTransportMiddlewareBinding[];
}): void {
  for (const route of options.transport.routes) {
    mountRoute({
      family: options.family,
      route,
      app: options.app,
      credential: "apiKey",
      authenticate: () => async (context, next) => {
        setProjectTransportAuthorization(context, options.authorization(context));
        await next();
      },
      authorize: () => {},
      afterSuccess: void 0,
      middleware: options.middleware ?? [],
      familyPolicy: true,
    });
  }
}

function mountRoute<Api>({
  family,
  route,
  app,
  credential,
  authenticate,
  authorize,
  afterSuccess,
  middleware,
  familyPolicy = false,
}: {
  family: RestApiVersionedFamily;
  route: RestTransportRoute<Api>;
  app: () => Api;
  credential: HandlerCredential;
  authenticate: ProjectTransportMount<Api>["authenticate"];
  authorize: ProjectTransportMount<Api>["authorize"];
  afterSuccess: ProjectTransportMount<Api>["afterSuccess"];
  middleware: readonly RestTransportMiddlewareBinding[];
  familyPolicy?: boolean;
}): void {
  const middlewareBindings = resolveMiddlewareBindings(route.middleware ?? [], middleware);

  family.service.registerTransportRoute(
    route.method,
    route.path,
    route.version,
    async (context, input) => {
      await authenticateRoute({ context, authenticate, permission: route.permission });
      const authorization = projectTransportAuthorization(context);
      assertInputProjectScope(input, authorization.scope);
      await authorize({ permission: route.permission, input, authorization });
      const facts: unknown[] = [];

      for (const binding of middlewareBindings) {
        facts.push(await binding.middleware.schema.parseAsync(await binding.resolve(context)));
      }

      const result = await route.handler(
        {
          app: app(),
          input,
          actor: authorization.actor,
          scope: authorization.scope,
          signal: context.req.raw.signal,
        },
        ...facts,
      );

      await afterSuccess?.({ context, input, authorization });

      return result;
    },
    (endpoint) => {
      let defined = route.params ? endpoint.withParams(route.params) : endpoint;

      if (route.query) {
        defined = defined.withQuery(route.query);
      }

      if (route.input) {
        defined = defined.withInput(route.input);
      }

      if (route.bodyLimit) {
        const limit = route.bodyLimit;

        defined = defined.withMiddleware(
          bodyLimit({
            maxSize: limit.maxBytes,
            onError: () => {
              throw limit.onExceeded();
            },
          }),
        );
      }

      const policy = handlerManagedAuth({
        reason: "project credential and permission enforced by the transport host",
        credential,
        permissions: [route.permission],
      });

      const protectedEndpoint = family.policy(familyPolicy ? route.permission : policy)(defined);

      const documented = protectedEndpoint.withDocs({
        operationId: route.operation,
        ...route.docs,
      });

      const output = documented.withOutput(route.output);

      return route.status === void 0 ? output : output.withStatus(route.status);
    },
  );
}

function resolveMiddlewareBindings(
  declarations: readonly RestTransportMiddleware[],
  bindings: readonly RestTransportMiddlewareBinding[],
): RestTransportMiddlewareBinding[] {
  return declarations.map((declaration) => {
    const matches = bindings.filter((binding) => binding.middleware === declaration);

    if (matches.length !== 1) {
      throw new Error(`REST middleware "${declaration.name}" must have exactly one binding`);
    }

    return matches[0]!;
  });
}

async function authenticateRoute({
  context,
  authenticate,
  permission,
}: {
  context: Context;
  authenticate: ProjectTransportMount<unknown>["authenticate"];
  permission: AuthzPermission;
}): Promise<void> {
  let continued = false;

  await authenticate({ permission })(context, async () => {
    continued = true;
  });

  if (!continued) {
    throw new Error("Project transport authentication ended without establishing a caller");
  }
}

function projectTransportAuthorization(context: Context): ProjectTransportAuthorization {
  const parsed = trustedAuthorizationSchema.safeParse(context.get(TRANSPORT_AUTHORIZATION));

  if (!parsed.success) {
    throw new Error("Project transport authorization did not establish trusted handler facts");
  }

  const { actor, scope } = parsed.data;

  if (scope.tier !== "project") {
    throw new Error("Project transport authorization did not establish a project scope");
  }

  return { actor, scope };
}

const trustedAuthorizationSchema = z
  .object({ actor: actorSchema.nullable(), scope: declaredScopeIdSchema })
  .strip();

function assertInputProjectScope(input: unknown, scope: ProjectScope): void {
  const parsed = z.object({ projectId: z.string() }).partial().safeParse(input);

  if (parsed.success && parsed.data.projectId !== void 0 && parsed.data.projectId !== scope.id) {
    throw new Error("REST transport input projectId does not match the authorized project scope");
  }
}
