export {
  GroupIdentityAdapter,
  PersonalWorkspaceIdentityAdapter,
  TeamIdentityAdapter,
} from "./adapters/resource-identifiers.adapter";
export { PersonalWorkspaceDiagnosticsAdapter } from "./adapters/personal-workspace-diagnostics.adapter";
export {
  PostgresOrganizationMembershipAdapter,
  type PostgresOrganizationMembershipAdapterOptions,
} from "./adapters/postgres.organization-membership.adapter";
export {
  OrganizationGrantCachePort,
  OrganizationPromptSeedPort,
  OrganizationSeatLicensePort,
  OrganizationSessionRevocationPort,
  type OrganizationPlanUser,
  type OrganizationSeatDecision,
} from "./ports/organization-membership.port";
export {
  enrichTeamWithRoleBindings,
  OrganizationMembershipService,
} from "./services/organization-membership.service";
export {
  CannotDemoteLastAdminError,
  CannotDisableLastAdminError,
  CannotDisableSelfError,
  CannotRemoveLastAdminError,
  CannotRemoveSelfError,
  CustomRoleNotAssignableError,
  MemberNotFoundError,
  MemberSeatLimitReachedError,
  NoAdminConfiguredError,
  OrganizationNotFoundForTeamError,
  OrganizationSlugTakenError,
} from "./services/organization-membership.errors";
export { isCustomRole } from "./services/custom-role-naming";
export {
  getAutoCorrectedTeamRoleForOrganizationRole,
  getDefaultTeamRoleForOrganizationRole,
  getOrganizationRoleLabel,
  isBindingRoleAllowedForOrganizationRole,
  isTeamRoleAllowedForOrganizationRole,
  ORGANIZATION_TO_TEAM_ROLE_MAP,
  type TeamRoleValue,
} from "./services/member-role-constraints";
export {
  assertNoPersonalTeamScope,
  findSharedTeamIds,
} from "./services/personal-team-scope";
export type {
  AuditLogFilters,
  CreateAndAssignInput,
  CreateAndAssignResult,
  EnrichedAuditLog,
  MemberTeamBinding,
  OrganizationMemberSummary,
  OrganizationMemberWithUser,
  OrganizationRepository,
  UpdateMemberRoleResult,
} from "./repositories/organization-membership.repository";
export {
  PostgresOrganizationAdapter,
  type PostgresOrganizationAdapterOptions,
} from "./adapters/postgres.organization.adapter";
export {
  PersonalWorkspaceDiagnosticsPort,
  PersonalWorkspaceIdentityPort,
  OrganizationSettingsSecretPort,
  GroupIdentityPort,
  TeamIdentityPort,
  type StoredOrganizationSettings,
  type PersonalWorkspaceResourceIds,
} from "./ports/organization.port";
export {
  OrganizationApp,
  type FullyLoadedOrganization,
  type OrganizationAppDependencies,
  type OrganizationCaller,
  type OrganizationWithMembersAndTheirTeams,
} from "./app/organization.app";
export {
  createOrganizationRestApp,
  type OrganizationRestInviteService,
  type OrganizationRestMemberSummary,
  type OrganizationRestMemberTeamBinding,
  type OrganizationRestPorts,
  type OrganizationRestService,
} from "./transport/api-rest/organization.api";
export { TeamTrpcApi, type TeamTrpcContext } from "./transport/api-trpc/team.api";
export {
  GroupTrpcApi,
  type GroupTrpcContext,
  type GroupTrpcPorts,
} from "./transport/api-trpc/group.api";
export {
  JoinRequestTrpcApi,
  type JoinRequestTrpcContext,
  type JoinRequestTrpcPorts,
} from "./transport/api-trpc/join-request.api";
export {
  OnboardingTrpcApi,
  onboardingIntegrationMethodSchema,
  type OnboardingIntegrationMethod,
  type OnboardingTrpcContext,
  type OnboardingTrpcPorts,
} from "./transport/api-trpc/onboarding.api";
export {
  OrganizationTrpcApi,
  type OrganizationTrpcContext,
  type OrganizationTrpcPorts,
} from "./transport/api-trpc/organization.api";
export {
  PersonalWorkspaceFeaturesTrpcApi,
  type PersonalWorkspaceFeaturesTrpcContext,
} from "./transport/api-trpc/personal-workspace-features.api";
export { createGroupRestApp } from "./transport/api-rest/group.api";
export {
  createOrganizationsRestApp,
  type OrganizationProvisioningPort,
  type OrganizationProvisioningSummary,
  verifyInstanceAdminKey,
} from "./transport/api-rest/organization-provisioning.api";
export { ORGANIZATIONS_SPEC_OPTIONS } from "./transport/api-rest/organization-provisioning.openapi";
export { createTeamsRestApp } from "./transport/api-rest/team.api";
export {
  buildInviteAcceptUrl,
  buildMembersSettingsUrl,
} from "./services/invite-link";
export {
  resolveInviteDisplayStatus,
  type InviteDisplayStatus,
} from "./services/invite-rules";
export {
  AlreadyOrganizationMemberError,
  DuplicateInviteError,
  InviteExpiredError,
  InviteNotFoundError,
  InviteNotReadyError,
  InviteThrottledError,
  InviteWrongAccountError,
  TeamNotInOrganizationError,
} from "./services/invite.errors";
