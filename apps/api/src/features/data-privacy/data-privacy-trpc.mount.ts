/**
 * The two project-id checks pass as MIDDLEWARES, not declarations, so the
 * sweep counts coverage where enforcement actually runs.
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
 * Mounts `dataPrivacy.*` on the tRPC root. `TSnapshot`/`TPolicy` are inferred
 * from the process's own readers so responses keep their real shapes.
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
      validateOutput: service.validateOutput,
      policy: service.policy,
      scopeWritePolicy: service.custom(mount.checks.write),
      scopeRemovalPolicy: service.custom(mount.checks.removal),
    },
    mount.ports,
  );
}
