import { createLogger } from "@langwatch/observability";
import { Hono } from "hono";

import type { Authorize, Entitlements } from "../access/access.ts";
import { SurfaceUnconfiguredError } from "../errors.ts";
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
  claimsNoPrefix,
  middlewareScopesOf,
  routeScopesOf,
  type MountableRestApp,
} from "./addressing.ts";
import { CliTokenIdentity } from "./cli-token-identity.ts";
import type {
  RestDoorCredential,
  RestSharedPath,
  RestTransportDeclaration,
} from "./declaration.ts";
import type { IdempotentRunner } from "./idempotency.ts";
import { OtlpIngestIdentity } from "./otlp-ingest-identity.ts";
import {
  isRestCredentialBinding,
  type RestDoor,
  type RestTransportMiddlewareBinding,
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
import { SessionKeyIdentity } from "./session-key-identity.ts";

/** Every credential kind a family may name, except the four a module binds for itself. */
export type RestIdentities = Readonly<
  Record<
    Exclude<RestDoorCredential, "internal_secret" | "session_key" | "cli_token" | "otlp_ingest">,
    RestIdentity
  >
>;

/**
 * Which bearer guards one internal family, by the family's own namespace. Absent, a family
 * naming `internal_secret` without binding its own door refuses every call.
 */
export type RestFamilyBearers = (namespace: string) => RestIdentity;

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
    /** What the process answers on behalf of a module, on every family at once. */
    facts?: readonly RestTransportMiddlewareBinding[] | undefined;
    /** The plans a route declaring an entitlement asks; absent, it is refused at mount. */
    entitlements?: Entitlements | undefined;
    /** The SAME decisions tRPC authorizes through: lineage, kind reads and route proofs. */
    authz: Authorize;
  }): RestHost {
    return new RestHost(options);
  }

  /**
   * Each family carries its own absolute paths, so this is a route table
   * rather than a prefix scheme.
   */
  readonly app = new Hono();

  /** Which module claims each prefixed namespace mounted so far. */
  private readonly claims = new Map<string, string>();

  /** The prefixes claimed and the unprefixed addresses served so far, each with its module. */
  private readonly prefixes: ClaimedPrefix[] = [];
  private readonly unclaimed: UnclaimedAddress[] = [];

  private constructor(private readonly options: Parameters<typeof RestHost.create>[0]) {}

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
    const identities = this.identitiesFor(declaration);
    const { authz } = this.options;
    const bindings = options?.facts ?? [];
    const credentials = new Set<RestDoorCredential>();

    for (const binding of bindings) {
      if (!isRestCredentialBinding(binding)) continue;

      if (credentials.has(binding.credential)) {
        throw new Error(`REST ${declaration.namespace} binds ${binding.credential} more than once`);
      }

      credentials.add(binding.credential);
      identities[binding.credential] = binding.resolveIdentity();
    }

    const family: MountableRestApp = createRestRuntime({
      identity: everyRoutePublic(declaration)
        ? publicIdentity()
        : identities[declaration.credential as RestDoorCredential],
      doors: identities,
      ...(this.options.idempotency ? { idempotency: this.options.idempotency } : {}),
      ...(this.options.rateLimiter ? { rateLimiter: this.options.rateLimiter } : {}),
      ...(this.options.entitlements ? { entitlements: this.options.entitlements } : {}),
      authorization: { forRequest: () => authz },
      audit: this.options.audit,
      deprecationLog: restDeprecationLog,
    }).mount(declaration, {
      app,
      onError: (error, context) => {
        const response = canonicalErrorResponse(error, context);
        // A client that went away mid-request aborts its own read: no answer reaches it, no fault.
        const clientGone = context.req.raw.signal.aborted;
        if (response.status >= 500 && !clientGone) {
          restErrorLogger.error(
            { error, method: context.req.method, path: context.req.path },
            "REST request failed",
          );
        }
        return response;
      },
      facts: [
        ...(this.options.facts ?? []),
        ...(bindings.filter(
          (binding) => !isRestCredentialBinding(binding),
        ) as readonly RestTransportMiddlewareBinding[]),
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

  private identitiesFor(
    declaration: RestTransportDeclaration<unknown>,
  ): Record<RestDoorCredential, RestDoor> {
    return {
      ...this.options.identities,
      internal_secret:
        this.options.bearers?.(declaration.namespace) ??
        unboundInternalSecret(declaration.namespace),
      session_key: SessionKeyIdentity.unbound(declaration.namespace),
      cli_token: CliTokenIdentity.unbound(declaration.namespace),
      otlp_ingest: OtlpIngestIdentity.unbound(declaration.namespace),
    };
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

function unboundInternalSecret(namespace: string): RestIdentity {
  const refuse = (): never => {
    throw new SurfaceUnconfiguredError(`${namespace} internal secret`);
  };

  return { authenticate: refuse, identify: refuse };
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
