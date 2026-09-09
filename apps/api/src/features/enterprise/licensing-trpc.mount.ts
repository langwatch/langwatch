/**
 * Binds the licensing feature's declared procedures to this process's execution
 * path. Two namespaces, one application: the licence that sets a ceiling and
 * the ceiling a create button asks about are answered from one object.
 */
import type { TrpcRuntime } from "@langwatch/api/trpc";
import { bindTrpcFact } from "@langwatch/api/trpc";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import {
  callerEmailFact,
  licenseEnforcementTrpcTransport,
  licenseTrpcTransport,
} from "@langwatch/enterprise-licensing-server";

/** The one slice of the process context both licensing namespaces read. */
export interface LicensingHostContext {
  app: Readonly<{ licensing: LicensingApi }>;
  session?: Readonly<{ user: Readonly<{ email?: string | null }> }> | null;
}

/** Mounts `license.*` on the app process's tRPC root. */
export function createLicenseTrpcRouter<TContext extends LicensingHostContext>(
  runtime: TrpcRuntime<TContext>,
) {
  return runtime.mount(licenseTrpcTransport, (ctx) => ctx.app.licensing);
}

/**
 * Mounts `licenseEnforcement.*` on the app process's tRPC root. The caller's
 * address is bound HERE rather than read by the feature: which session this
 * deployment authenticated is the process's own answer.
 */
export function createLicenseEnforcementTrpcRouter<TContext extends LicensingHostContext>(
  runtime: TrpcRuntime<TContext>,
) {
  return runtime.mount(licenseEnforcementTrpcTransport, (ctx) => ctx.app.licensing, {
    facts: [bindTrpcFact(callerEmailFact, (ctx: TContext) => ctx.session?.user.email ?? null)],
  });
}
