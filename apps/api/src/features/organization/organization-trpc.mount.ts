/**
 * App-process transport mounts for the organization vertical: the organization
 * itself with its membership and invitations, the sign-up ceremony that
 * creates the first of each, plus the group and join-request surfaces.
 *
 * Behaviour is package-owned (`@langwatch/organization-server`); this supplies
 * the process's root, authenticated procedure, policy chain, and the
 * application ports the organization package does not own — the invitation
 * service, the licence seat guards, the Enterprise plan gate, the identity
 * ledger behind invitation matching, and the join-request service the process
 * composes over the identity ledger, the membership writer and the mailer.
 */
import { createTrpcApiService, type TrpcApiMount, type TrpcApiPorts } from "@langwatch/api/trpc";
import {
  GroupTrpcApi,
  JoinRequestTrpcApi,
  OnboardingTrpcApi,
  OrganizationTrpcApi,
  PersonalWorkspaceFeaturesTrpcApi,
  type PersonalWorkspaceFeaturesTrpcContext,
  type GroupTrpcContext,
  type GroupTrpcPorts,
  type JoinRequestTrpcContext,
  type JoinRequestTrpcPorts,
  type OnboardingTrpcContext,
  type OnboardingTrpcPorts,
  type OrganizationTrpcContext,
  type OrganizationTrpcPorts,
} from "@langwatch/organization-server";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";
import type { z } from "zod";

/**
 * The audit-log read's own `kind: "custom"` check, as the process built it.
 * It authorizes at the organization tier the query is anchored on and, when a
 * project filter is present, at the project tier too — a rule no declaration
 * kind can describe, so the middleware itself travels.
 */
type OrganizationAuditLogCheck = Readonly<{ auditLogCheck: unknown }>;

/** Mounts `organization.*` on the app process's tRPC root. */
export function createOrganizationTrpcRouter<
  TContext extends OrganizationTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TSignUpDataSchema extends z.ZodTypeAny,
>(
  mount: TrpcApiMount<TContext, TOptions, TRoot> &
    OrganizationAuditLogCheck &
    TrpcApiPorts<OrganizationTrpcPorts<TSignUpDataSchema>>,
) {
  const service = createTrpcApiService(mount);
  const procedures = { ...service, auditLogPolicy: service.custom(mount.auditLogCheck) };

  return OrganizationTrpcApi.create(mount.root, procedures, mount.ports);
}

/** Mounts `onboarding.*` on the app process's tRPC root. */
export function createOnboardingTrpcRouter<
  TContext extends OnboardingTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TSignUpDataSchema extends z.ZodTypeAny,
>(
  mount: TrpcApiMount<TContext, TOptions, TRoot> &
    TrpcApiPorts<OnboardingTrpcPorts<TSignUpDataSchema>>,
) {
  return OnboardingTrpcApi.create(mount.root, createTrpcApiService(mount), mount.ports);
}

/** Mounts `group.*` on the app process's tRPC root. */
export function createGroupTrpcRouter<
  TContext extends GroupTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot> & TrpcApiPorts<GroupTrpcPorts>) {
  return GroupTrpcApi.create(mount.root, createTrpcApiService(mount), mount.ports);
}

/** Mounts `joinRequests.*` on the app process's tRPC root. */
export function createJoinRequestTrpcRouter<
  TContext extends JoinRequestTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot> & TrpcApiPorts<JoinRequestTrpcPorts>) {
  return JoinRequestTrpcApi.create(mount.root, createTrpcApiService(mount), mount.ports);
}

/** Mounts `personalWorkspaceFeatures.*` on the app process's tRPC root. */
export function createPersonalWorkspaceFeaturesTrpcRouter<
  TContext extends PersonalWorkspaceFeaturesTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot>) {
  return PersonalWorkspaceFeaturesTrpcApi.create(mount.root, createTrpcApiService(mount));
}
