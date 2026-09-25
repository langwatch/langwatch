/**
 * Where every declared REST family mounts. Thin on purpose: it states which
 * credential answers which family and hands one application to the hosting.
 * REST IS API-key-authenticated — structural, never settable (§4).
 */
import type {
  FeatureRestHost,
  FeatureRestMountOptions,
  MountableTransport,
} from "@langwatch/kernel";
import { Hono } from "hono";

import type { RateLimiter } from "../ports.ts";
import type { MountableRestApp } from "./addressing.ts";
import { CliTokenIdentity } from "./cli-token-identity.ts";
import type { RestDoorCredential, RestTransportDeclaration } from "./declaration.ts";
import type { IdempotentRunner } from "./idempotency.ts";
import { isRestCredentialBinding, type RestTransportMiddlewareBinding } from "./request.ts";
import { canonicalErrorResponse } from "./response.ts";
import { createRestRuntime, type RestAuditSink, type RestIdentity } from "./runtime.ts";
import { SessionKeyIdentity } from "./session-key-identity.ts";

/** Every credential kind a family may name, except the three a module binds for itself. */
export type RestIdentities = Readonly<
  Record<Exclude<RestDoorCredential, "internalSecret" | "sessionKey" | "cliToken">, RestIdentity>
>;

/**
 * Which bearer guards one internal family, by the family's own namespace: a
 * cron bearer must not reach the agent manager. Each bearer's target home is
 * its declaring module's transport declaration; that migration consumes this seam.
 */
export type RestFamilyBearers = (namespace: string) => RestIdentity;

export class RestHost implements FeatureRestHost<MountableRestApp> {
  static create(options: {
    identities: RestIdentities;
    bearers: RestFamilyBearers;
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
  }): RestHost {
    return new RestHost(options);
  }

  /**
   * Each family carries its own absolute paths, so this is a route table
   * rather than a prefix scheme.
   */
  readonly app = new Hono();

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
    const identities = this.identitiesFor(declaration);
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
      audit: this.options.audit,
    }).mount(declaration, {
      app,
      onError: (error, context) => canonicalErrorResponse(error, context),
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

  private identitiesFor(
    declaration: RestTransportDeclaration<unknown>,
  ): Record<RestDoorCredential, RestIdentity> {
    return {
      ...this.options.identities,
      internalSecret: this.options.bearers(declaration.namespace),
      sessionKey: SessionKeyIdentity.unbound(declaration.namespace),
      cliToken: CliTokenIdentity.unbound(declaration.namespace),
    };
  }
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
