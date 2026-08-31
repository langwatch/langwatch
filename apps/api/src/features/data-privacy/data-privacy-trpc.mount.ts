/**
 * App-process transport mount for the scoped privacy rules.
 *
 * Behaviour is package-owned (`@langwatch/data-privacy-server`); this supplies
 * the process's root, authenticated procedure, policy chain, the readers and
 * writers the feature does not own, and the two resolver-authorized checks the
 * writes are declared with.
 *
 * Those two checks are passed as MIDDLEWARES rather than as declarations this
 * file restates. What each one claims is which assertion enforces the project
 * id, and both assertions are the application's — they resolve the scope's
 * owning organization out of the process's own tables and probe the permission
 * that tier demands. A declaration is a claim the sweep counts as coverage, so
 * it has to be written where the enforcement is; `createTrpcApiService`'s
 * `custom` exists for exactly this, wrapping a check the caller hands over
 * already built.
 */
import { createTrpcApiService, type TrpcApiMount, type TrpcApiPorts } from "@langwatch/api/trpc";
import {
  DataPrivacyTrpcApi,
  type DataPrivacyTrpcContext,
  type DataPrivacyTrpcPorts,
} from "@langwatch/data-privacy-server";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

/**
 * The process's own authorization for the two rule writes, each already
 * carrying the declaration that names what enforces the project id.
 */
export type DataPrivacyTrpcChecks = Readonly<{
  /** Declared and enforced for `setForScope`. */
  write: unknown;
  /** Declared and enforced for `removeForScope`. */
  removal: unknown;
}>;

/**
 * Mounts `dataPrivacy.*` on the app process's tRPC root.
 *
 * `TSnapshot` and `TPolicy` are inferred from the process's own readers, so
 * the settings snapshot and the written rule reach the client with the shapes
 * they have always had rather than narrowed copies of them.
 */
export function createDataPrivacyTrpcRouter<
  TContext extends DataPrivacyTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TSnapshot,
  TPolicy,
>(
  mount: TrpcApiMount<TContext, TOptions, TRoot> &
    TrpcApiPorts<DataPrivacyTrpcPorts<TSnapshot, TPolicy>> &
    Readonly<{ checks: DataPrivacyTrpcChecks }>,
) {
  const service = createTrpcApiService(mount);

  return DataPrivacyTrpcApi.create(
    mount.root,
    {
      protected: service.protected,
      policy: service.policy,
      scopeWritePolicy: service.custom(mount.checks.write),
      scopeRemovalPolicy: service.custom(mount.checks.removal),
    },
    mount.ports,
  );
}
