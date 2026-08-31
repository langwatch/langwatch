/**
 * The governance vertical's Enterprise tRPC surfaces, composed for the legacy
 * web application's router root.
 *
 * Three transports live here: the CLI/device sessions surface every user
 * reaches on their own devices (`personalSessions`), the org-scoped session
 * policy an admin turns from `/governance` (`sessionPolicy`), and the
 * ingestion-keys mint/rotate/list surface that powers the /me Trace Ingest
 * grid (`ingestionKey`). Each router's behaviour — procedure names, input and
 * output shapes, refusals — belongs to the governance feature package. What
 * this composition owns is the wiring: which policy wraps which declaration,
 * and which process capability answers each port.
 *
 * It sits in the Enterprise API composition rather than in `apps/api` for the
 * same reason its siblings do: a core package may not depend on an Enterprise
 * one. Everything the process must supply arrives through `create`, so this
 * package never imports an application.
 *
 * The rest of the governance surface — ingestion sources, anomaly rules, AI
 * tools, departments, the top-level `governance.*` router — still owns its
 * procedures in `platform/app` and follows in the same shape as it moves.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  IngestionKeyTrpcApi,
  PersonalSessionsTrpcApi,
  SessionPolicyTrpcApi,
  type IngestionKeyTrpcContext,
  type PersonalSessionsTrpcContext,
  type SessionPolicyTrpcContext,
} from "@langwatch/enterprise-governance-server";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";

/** Every context requirement the surfaces place on the process. */
export type EnterpriseGovernanceTrpcContext = PersonalSessionsTrpcContext &
  SessionPolicyTrpcContext &
  IngestionKeyTrpcContext;

/** One already-composed process policy, applied after a feature's input parser. */
type EnterpriseTrpcPolicy = <TProcedure>(procedure: TProcedure) => TProcedure;

/** Explicit Enterprise governance tRPC transports; mounting stays application-owned. */
export class EnterpriseGovernanceTrpcComposition {
  static create<
    TContext extends EnterpriseGovernanceTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(options: {
    /** The process's one tRPC root; feature routers must not create a second. */
    root: TRPCRootObject<TContext, object, TOptions, TRoot>;
    /** The process's authenticated procedure. */
    protectedProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
    /** The process's full policy chain for one declared permission. */
    policy(permission: AuthzPermission): EnterpriseTrpcPolicy;
  }) {
    const { root, protectedProcedure, policy } = options;

    return {
      personalSessions: PersonalSessionsTrpcApi.create(root, {
        protected: protectedProcedure,
        policy,
      }),
      sessionPolicy: SessionPolicyTrpcApi.create(root, {
        protected: protectedProcedure,
        policy,
      }),
      ingestionKey: IngestionKeyTrpcApi.create(root, {
        protected: protectedProcedure,
        policy,
      }),
    };
  }
}
