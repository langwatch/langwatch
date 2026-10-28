import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { Hono } from "hono";

import type { Authorize, Entitlements } from "../access/access.ts";
/**
 * Where every declared REST family mounts. Thin on purpose: it states which
 * credential answers which family and hands one application to the hosting.
 * REST IS API-key-authenticated — structural, never settable (§4).
 */
import type {
  FeatureRestHost,
  FeatureRestMountOptions,
  MountableTransport,
} from "../hosting/transport-hosts.ts";
import type { RateLimiter } from "../ports.ts";
import { allRegisteredRoutes } from "../route-registry.ts";
import {
  API_VERSION_HEADER,
  basePathOf,
  canonicalV1Path,
  claimsNoPrefix,
  middlewareScopesOf,
  datedRoutePattern,
  pinnedVersionPath,
  type DatedFamilyRoutes,
  routeScopesOf,
  type MountableRestApp,
} from "./addressing.ts";
import type { RestConfirmationGate } from "./confirmation.ts";
import type {
  RestDoorCredential,
  RestSharedPath,
  RestTransportDeclaration,
} from "./declaration.ts";
import type { IdempotentRunner } from "./idempotency.ts";
import { withOtlpPathAliases } from "./otlp-path-alias.ts";
import {
  isRestCredentialBinding,
  type RestDoor,
  type MiddlewareContextBinding,
} from "./request.ts";
import { canonicalErrorResponse } from "./response.ts";
import { createRestRuntime, type RestDeprecationLog } from "./runtime.ts";

const restErrorLogger = createLogger("langwatch:api:rest");

/** One warning per deprecated route per process: an operator sees a superseded door in use. */
const restDeprecationLog: RestDeprecationLog = {
  deprecatedRouteCalled: (route) => restErrorLogger.warn(route, "Deprecated REST route called"),
};
import type { RestAuditSink, RestIdentity } from "../hosting/api-door.ts";
import { assertEveryRouteDeclared } from "./security.ts";

/** Every credential kind a family may name, except the ones a module binds for itself. */
export type RestIdentities = Readonly<
  Record<
    Exclude<
      RestDoorCredential,
      | "internal_secret"
      | "scim_token"
      | "session_key"
      | "cli_token"
      | "otlp_ingest"
      | "licence_token"
    >,
    RestIdentity
  >
>;

/**
 * Which bearer guards one internal family, by the family's own namespace. Absent, a family
 * naming `internal_secret` without binding its own door refuses the boot.
 */
export type RestFamilyBearers = (namespace: string) => RestIdentity;

/**
 * An upgrade in progress and a busy ClickHouse are expected 503s, so they warn; so does a refused
 * private dataplane, which the stores log once at error. Every other 5xx stays an error.
 */
function restFailureLevel(error: unknown): "warn" | "error" {
  return HandledError.isHandled(error) && WARNED_REFUSALS.has(error.code) ? "warn" : "error";
}

const WARNED_REFUSALS: ReadonlySet<string> = new Set([
  "upgrade_in_progress",
  "private_dataplane_unavailable",
  "clickhouse_overloaded",
]);

export class RestHost implements FeatureRestHost<MountableRestApp> {
  static create(options: {
    identities: RestIdentities;
    bearers?: RestFamilyBearers | undefined;
    /** Every route-declared trail lands on this ONE sink. */
    audit: RestAuditSink;
    /**
     * The process's ONE receipt ledger, behind every create a route declared
     * replayable. Absent on a deployment with no database, such a route is
     * refused at mount rather than answering as though it were protected.
     */
    idempotency?: IdempotentRunner | undefined;
    /**
     * The counter a route declaring a rate limit is counted against. Absent on
     * a deployment with no Redis, such a route is refused at mount rather than
     * answering uncounted.
     */
    rateLimiter?: RateLimiter | undefined;
    /** Middleware context answered on every family at once: only the document build refuses it. */
    middlewareContext?: readonly MiddlewareContextBinding[] | undefined;
    /** The plans a route declaring an entitlement asks; absent, it is refused at mount. */
    entitlements?: Entitlements | undefined;
    /** The SAME decisions tRPC authorizes through: lineage, kind reads and route proofs. */
    authz: Authorize;
    /** Where a Langy key's confirmation clicks are kept; absent, marked routes refuse it. */
    confirmations?: RestConfirmationGate | undefined;
  }): RestHost {
    return new RestHost(options);
  }

  /**
   * Each family carries its own absolute paths, so this is a route table
   * rather than a prefix scheme.
   */
  readonly app = withOtlpPathAliases(new Hono());

  /** Which module claims each prefixed namespace mounted so far. */
  private readonly claims = new Map<string, string>();

  /** The prefixes claimed and the unprefixed addresses served so far, each with its module. */
  private readonly prefixes: ClaimedPrefix[] = [];
  private readonly unclaimed: UnclaimedAddress[] = [];

  /** Each dated family's base, its `/api/v1` twin and its routes: where `X-API-Version` pins. */
  private readonly datedFamilies: DatedFamilyRoutes[] = [];

  private constructor(private readonly options: Parameters<typeof RestHost.create>[0]) {
    // Ahead of every family: a pinned request is answered again at its dated address, so the
    // header and a dated URL select through the one path (public-rest.feature).
    this.app.use("*", async (context, next) => {
      let pinned: string | null;

      try {
        pinned = this.pinnedAddressOf({
          method: context.req.method,
          path: context.req.path,
          header: context.req.header(API_VERSION_HEADER),
        });
      } catch (error) {
        return canonicalErrorResponse(error, context);
      }

      if (pinned === null) return next();

      const url = new URL(context.req.raw.url);
      url.pathname = pinned;

      return this.app.fetch(new Request(url, context.req.raw), context.env);
    });
  }

  /**
   * The dated address a request naming `X-API-Version` is answered at, or null where it was sent:
   * only a route of a dated family mounted so far is pinned (public-rest.feature).
   */
  pinnedAddressOf(
    request: Readonly<{ method: string; path: string; header: string | undefined }>,
  ): string | null {
    return pinnedVersionPath({ ...request, datedFamilies: this.datedFamilies });
  }

  /**
   * One declared family. Every credential kind opens for each mount: a ROUTE
   * may raise its own — the cron bearer sits on two routes of a project family —
   * and it resolves through the same table.
   */
  mount(
    transport: MountableTransport,
    app: () => unknown,
    options?: FeatureRestMountOptions,
  ): MountableRestApp {
    const declaration = transport as RestTransportDeclaration<unknown>;
    this.claimNamespace(declaration);
    this.noteDatedBase(declaration);
    const identities: Partial<Record<RestDoorCredential, RestDoor>> = {
      ...this.options.identities,
      ...(this.options.bearers
        ? { internal_secret: this.options.bearers(declaration.namespace) }
        : {}),
    };
    const { authz } = this.options;
    const bindings = options?.middlewareBindings ?? [];
    const credentials = new Set<RestDoorCredential>();

    for (const binding of bindings) {
      if (!isRestCredentialBinding(binding)) continue;

      if (credentials.has(binding.credential)) {
        throw new Error(`REST ${declaration.namespace} binds ${binding.credential} more than once`);
      }

      credentials.add(binding.credential);
      identities[binding.credential] = binding.resolveIdentity();
    }

    assertDoorsBound({ declaration, identities });

    const family: MountableRestApp = createRestRuntime({
      identity: everyRoutePublic(declaration)
        ? publicIdentity()
        : (identities[declaration.credential] ?? publicIdentity()),
      doors: identities,
      ...(this.options.idempotency ? { idempotency: this.options.idempotency } : {}),
      ...(this.options.rateLimiter ? { rateLimiter: this.options.rateLimiter } : {}),
      ...(this.options.entitlements ? { entitlements: this.options.entitlements } : {}),
      ...(this.options.confirmations ? { confirmations: this.options.confirmations } : {}),
      authorization: { forRequest: () => authz },
      servedDoors: true,
      audit: this.options.audit,
      deprecationLog: restDeprecationLog,
    }).mount(declaration, {
      app,
      onError: (error, context) => {
        const response = canonicalErrorResponse(error, context);
        // A client that went away mid-request aborts its own read: no answer reaches it, no fault.
        const clientGone = context.req.raw.signal.aborted;
        if (response.status >= 500 && !clientGone) {
          restErrorLogger[restFailureLevel(error)](
            { error, method: context.req.method, path: context.req.path },
            "REST request failed",
          );
        }
        return response;
      },
      middlewareContext: [
        ...(this.options.middlewareContext ?? []),
        ...(bindings.filter(
          (binding) => !isRestCredentialBinding(binding),
        ) as readonly MiddlewareContextBinding[]),
      ],
    });

    this.app.route("/", family);

    return family;
  }

  /**
   * Refuses to serve while this application answers a route no declaration registered,
   * naming each one. Reads only the REST application: tRPC, websocket and raw HTTP
   * never mount here.
   */
  assertEveryRouteDeclared(): void {
    assertEveryRouteDeclared({ app: this.app, registry: allRegisteredRoutes() });
  }

  /**
   * A dated family answers a pinned version at its dated addresses, a family wholly on another's
   * shared path included; a literal route beneath its base has none and is left alone.
   */
  private noteDatedBase(declaration: RestTransportDeclaration<unknown>): void {
    if (declaration.addressing !== "dated") return;

    const base = basePathOf(declaration);
    const twin = declaration.v1Twin ? canonicalV1Path(base) : null;
    const routes = declaration.routes.map((route) => ({
      method: route.method,
      pattern: datedRoutePattern(route.path),
    }));

    for (const each of twin ? [base, twin] : [base]) {
      this.datedFamilies.push({ base: each, routes });
    }
  }

  /**
   * A family claiming a prefix claims `/api/<namespace>` whole, so a second module's would run
   * its middleware ahead of the first's routes: it declares a shared path instead (§8, R10).
   */
  private claimNamespace(declaration: RestTransportDeclaration<unknown>): void {
    const serving = declaration.api.name;

    if (claimsNoPrefix(declaration)) {
      const addresses = addressesOfFamilyClaimingNoPrefix(declaration);
      for (const address of addresses) {
        for (const claim of this.prefixes) assertSharedPathAdmitted({ address, claim });
      }
      this.unclaimed.push(...addresses);
      return;
    }

    const claimant = this.claims.get(declaration.namespace);

    if (claimant !== void 0 && claimant !== serving) {
      throw new Error(
        `REST "${declaration.namespace}" of ${serving} claims a namespace ${claimant} already claims; ` +
          `declare .withSharedPath({ owner: "${claimant}", reason, deprecate }) on each of its routes`,
      );
    }

    const claims = middlewareScopesOf(declaration).map((scope) => ({
      prefix: scope.replace(/\/\*$/, ""),
      module: serving,
    }));
    for (const claim of claims) {
      for (const address of this.unclaimed) assertSharedPathAdmitted({ address, claim });
    }
    this.prefixes.push(...claims);
    this.claims.set(declaration.namespace, serving);
  }
}

type ClaimedPrefix = { prefix: string; module: string };

type UnclaimedAddress = {
  method: string;
  path: string;
  module: string;
  sharedPath: RestSharedPath | undefined;
};

/** Each address the routes of a family claiming no prefix answer at, v1 twins included. */
function addressesOfFamilyClaimingNoPrefix(
  declaration: RestTransportDeclaration<unknown>,
): UnclaimedAddress[] {
  return declaration.routes.flatMap((route) =>
    routeScopesOf({ route, declaration }).map((path) => ({
      method: route.method.toUpperCase(),
      path,
      module: declaration.api.name,
      sharedPath: route.sharedPath,
    })),
  );
}

/**
 * A route claiming no prefix, under a prefix another module's family claims, runs that family's
 * middleware: it says so with `.withSharedPath`, naming the claimant (§8, R10).
 */
function assertSharedPathAdmitted({
  address,
  claim,
}: {
  address: UnclaimedAddress;
  claim: ClaimedPrefix;
}): void {
  const under = address.path === claim.prefix || address.path.startsWith(`${claim.prefix}/`);
  if (!under || address.module === claim.module) return;

  const where = `REST ${address.method} ${address.path} of ${address.module} sits under ${claim.prefix}, which ${claim.module} claims`;

  if (address.sharedPath === void 0) {
    throw new Error(
      `${where}; declare .withSharedPath({ owner: "${claim.module}", reason, deprecate }) on the route, ` +
        `or serve it under a prefix ${address.module} owns`,
    );
  }

  if (address.sharedPath.owner !== claim.module) {
    throw new Error(
      `${where}, but its shared path names ${address.sharedPath.owner}; ` +
        `declare .withSharedPath({ owner: "${claim.module}", ... }) instead`,
    );
  }
}

/**
 * Every door a non-public route answers behind is bound before the family serves (Alex
 * 2026-10-10 TYPED-DOORS): an unbound one refuses the boot by name, never a request.
 */
function assertDoorsBound({
  declaration,
  identities,
}: {
  declaration: RestTransportDeclaration<unknown>;
  identities: Partial<Record<RestDoorCredential, RestDoor>>;
}): void {
  const unbound = new Set(
    declaration.routes
      .filter((route) => route.access?.kind !== "public")
      .map((route) => route.credential ?? declaration.credential)
      .filter((credential) => identities[credential] === void 0),
  );

  if (unbound.size === 0) return;

  throw new Error(
    `REST ${declaration.namespace} of ${declaration.api.name} answers behind ` +
      `${[...unbound].map((credential) => `"${credential}"`).join(", ")}, which nothing binds; ` +
      "bind it with the module's .withDoors({ ... }) or supply it from the host",
  );
}

/**
 * A family whose every route is public resolves nothing at all, whatever
 * credential its declaration nominally carries.
 */
function everyRoutePublic(declaration: RestTransportDeclaration<unknown>): boolean {
  return declaration.routes.every((route) => route.access?.kind === "public");
}

function publicIdentity(): RestIdentity {
  return {
    authenticate: () => {
      throw new Error("A public REST route answers with no credential resolved.");
    },
  };
}
