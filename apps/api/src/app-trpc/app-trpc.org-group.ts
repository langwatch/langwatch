/**
 * The nine tRPC surfaces a TENANT is administered through, mounted as one
 * group on the process's own root.
 *
 *   organization         the organization itself: its members, their team
 *                        bindings, its audit trail and its invitations.
 *   project              a project's own lifecycle — created, renamed,
 *                        re-keyed, archived — and the settings form behind it.
 *   codingAgents         what the coding agents did inside those projects.
 *   automation           the triggers a project fires on, and their channels.
 *   emailSuppression     who asked those channels to stop writing to them.
 *   license              the signed instance licence and its sign-on gate.
 *   licenseEnforcement   the seat and resource limits that licence carries.
 *   scimToken            the directory-sync credentials an organization mints.
 *   ssoConnections       the back office's single sign-on connection ledger.
 *
 * ## Why one group rather than nine entries
 *
 * They are one graph, in the way that matters at a composition root: every one
 * of them is a write against the TENANT rather than against what the tenant
 * recorded. An organization's membership decides which projects exist; a
 * project's own settings decide what its automations may deliver and what a
 * coding-agent session may show; the licence decides how many members and
 * projects there may be at all. Naming them individually on
 * {@link AppTrpcFeaturePorts} would put nine entries on a file five other
 * halves of the record also edit; naming them once here keeps that file's diff
 * to one import, one parameter and one spread — the same shape the trace group
 * settled on for the same reason.
 *
 * ## The Enterprise four
 *
 * They ride this group rather than a group of their own because the tenant is
 * what they are about, and because their whole seam is one class in
 * `@langwatch/enterprise-api`: a core process may not depend on an Enterprise
 * feature package, so the four arrive together or not at all. Their
 * `ctx.app` slices — the licensing application, the usage-limit notifier and
 * the SCIM application — are composed by the same fold that composes the other
 * five, and refuse BY NAME on a deployment that composed no Enterprise
 * application rather than answering as though it had none of those features.
 */
import type { TrpcApiMount, TrpcApiPublicMount } from "@langwatch/api/trpc";
import type {
  AutomationTrpcContext,
  EmailSuppressionTrpcContext,
  EmailSuppressionTrpcPorts,
} from "@langwatch/automation-server";
import type {
  CodingAgentTrpcContext,
  CodingAgentTrpcPorts,
} from "@langwatch/coding-agent-server";
import type { EnterpriseTrpcContext } from "@langwatch/enterprise-api";
import type {
  OrganizationTrpcContext,
  OrganizationTrpcPorts,
} from "@langwatch/organization-server";
import type { ProjectTrpcContext } from "@langwatch/project-server";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";
import type { ZodTypeAny } from "zod";

import {
  createAutomationTrpcRouter,
  createEmailSuppressionTrpcRouter,
  type AutomationMountPorts,
} from "../features/automation/automation-trpc.mount";
import { createCodingAgentTrpcRouter } from "../features/coding-agent/coding-agent-trpc.mount";
import {
  createEnterpriseTrpcRouters,
  type EnterpriseTrpcMountPorts,
} from "../features/enterprise/enterprise-trpc.mount";
import { createOrganizationTrpcRouter } from "../features/organization/organization-trpc.mount";
import {
  createProjectTrpcRouter,
  type ProjectTrpcChecks,
  type ProjectTrpcMountPorts,
} from "../features/project/project-trpc.mount";

/**
 * The request context this group is resolved against: the intersection of the
 * nine surfaces' own contexts.
 *
 * Written down once for the same reason {@link ApiTrpcFeatureApplication} is —
 * so "what must a request carry for the whole group to mount" is one statement
 * rather than nine compile errors.
 */
export type AppOrgGroupTrpcContext = AutomationTrpcContext &
  CodingAgentTrpcContext &
  EmailSuppressionTrpcContext &
  EnterpriseTrpcContext &
  OrganizationTrpcContext &
  ProjectTrpcContext;

/**
 * The capabilities the nine surfaces reach that their own feature packages do
 * not own.
 *
 * Generic only in the sign-up questionnaire, which is the one shape a CLIENT
 * sees derived from a port: `organization.createAndAssign` forwards the
 * deployment's own form answers opaquely, and collapsing that to `unknown`
 * would hand the sign-up pages `unknown`.
 */
export interface AppOrgGroupTrpcPorts<TSignUpDataSchema extends ZodTypeAny = ZodTypeAny> {
  /**
   * The forty-six answers `organization.*` needs from the deployment: the
   * permission probes a member list is widened by, the licence seat guards,
   * the Enterprise plan gates, the invitation service and the product trail.
   */
  organization: OrganizationTrpcPorts<TSignUpDataSchema>;
  /**
   * The audit-log read's own `kind: "custom"` check, already built.
   *
   * `auditLog` is grantable at project, team and organization, and the
   * declared check resolves to the narrowest tier whose id the input carries —
   * so an optional `projectId` filter would move the whole check to the
   * project tier and leave the organization the query is ANCHORED on
   * unauthorized. A caller holding `auditLog:view` on any one project could
   * then read a different organization's org-scoped trail. No declaration kind
   * describes that, so the middleware itself travels.
   */
  organizationAuditLogCheck: unknown;
  /**
   * The six answers `project.*` needs: secret encryption for the stored-object
   * credentials, an imperative permission probe for the SECOND project an
   * archive names, the caller's captured-content visibility, Langy's virtual
   * key, the audit trail behind a key rotation and the error reporter.
   */
  project: ProjectTrpcMountPorts;
  /** `project.create`'s custom tier resolution and the trace-sharing demand. */
  projectChecks: ProjectTrpcChecks;
  /**
   * What one viewer may see of one project: whether captured content is
   * readable and whether spend is. Resolved from the project's protections by
   * the rules that own each — content by the data-privacy policy, spend by the
   * `cost:view` cut those protections already carry.
   */
  codingAgents: CodingAgentTrpcPorts;
  /**
   * The three capabilities the automation transport reaches that automation
   * does not own: the shared rate-limit counter, the provider registry's
   * secret handling — the encryption key is the deployment's — and the Slack
   * channel listing. The trace-filter dry run is NOT here: the mount owns it,
   * because it is this process's own query compiler.
   */
  automation: AutomationMountPorts;
  /** The unsubscribe pair's client address, its throttle and its audit trail. */
  emailSuppression: EmailSuppressionTrpcPorts;
  /** The SCIM plan gate, and the back office's connection ledger with its trail. */
  enterprise: EnterpriseTrpcMountPorts;
}

/**
 * The group's ports with the questionnaire widened, for a host that publishes
 * no client type.
 *
 * A composition root hands the record on as a `TRPCRouterRecord` and derives
 * nothing, so it states this alias rather than restating the parameter.
 */
export type AnyAppOrgGroupTrpcPorts = AppOrgGroupTrpcPorts<ZodTypeAny>;

/**
 * Builds all nine surfaces against one process's mount.
 *
 * The result is keyed by the namespace each answers on, so the caller spreads
 * it into the record and adds nothing per feature. Generic in the whole ports
 * object rather than in its members: every factory below infers its own
 * parameters from the slice it is handed, so the concrete shapes a process
 * wired in survive into the record's inferred type instead of collapsing to
 * the widened alias above.
 */
export function createAppOrgGroupTrpcFeatures<
  TContext extends AppOrgGroupTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TPorts extends AnyAppOrgGroupTrpcPorts,
>(options: {
  mount: TrpcApiMount<TContext, TOptions, TRoot> & TrpcApiPublicMount<TContext, TOptions, TRoot>;
  ports: TPorts;
}) {
  const { mount, ports } = options;
  const enterprise = createEnterpriseTrpcRouters({ ...mount, ports: ports.enterprise });

  return {
    automation: createAutomationTrpcRouter({ ...mount, ports: ports.automation }),
    codingAgents: createCodingAgentTrpcRouter({ ...mount, ports: ports.codingAgents }),
    // The unsubscribe pair arrives from a mail client with no session, so this
    // one takes the process's PUBLIC procedure as well. In the record rather
    // than beside it for the same reason every other public surface here is:
    // a namespace mounted outside the list would serve traffic from outside
    // every audit that reads it.
    emailSuppression: createEmailSuppressionTrpcRouter({
      ...mount,
      publicProcedure: mount.publicProcedure,
      ports: ports.emailSuppression,
    }),
    license: enterprise.license,
    licenseEnforcement: enterprise.licenseEnforcement,
    organization: createOrganizationTrpcRouter({
      ...mount,
      auditLogCheck: ports.organizationAuditLogCheck,
      ports: ports.organization,
    }),
    project: createProjectTrpcRouter({
      ...mount,
      ports: ports.project,
      checks: ports.projectChecks,
    }),
    scimToken: enterprise.scimToken,
    ssoConnections: enterprise.ssoConnections,
  };
}
