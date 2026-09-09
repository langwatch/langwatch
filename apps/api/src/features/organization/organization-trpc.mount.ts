/**
 * Binds the organization module's six declared namespaces to this process's
 * execution path: the organization itself with its membership and invitations,
 * the sign-up ceremony that creates the first of each, the teams and groups
 * that carve it up, the join requests waiting on it, and the personal
 * workspace's own switches.
 *
 * One fact travels with three of them: the signed-in person as the session
 * carries them. The plan provider, the seat guard and the disable guard each
 * identify the operator by more than their id, and a handler may not reach for
 * the request itself.
 */
import { bindTrpcFact, type TrpcRuntime } from "@langwatch/api/trpc";
import type { OrganizationApi } from "@langwatch/organization-contract";
import {
  groupTrpcTransport,
  joinRequestTrpcTransport,
  onboardingTrpcTransport,
  organizationSessionPersonFact,
  organizationTrpcTransport,
  personalWorkspaceFeaturesTrpcTransport,
  teamTrpcTransport,
} from "@langwatch/organization-server";

/** The one slice of the process context these six namespaces read. */
export interface OrganizationHostContext {
  app: Readonly<{ organizations: OrganizationApi }>;
  session?: Readonly<{ user: Readonly<{ name?: string | null; email?: string | null }> }> | null;
}

/** Mounts all six namespaces on the app process's declared tRPC runtime. */
export function createOrganizationTrpcRouters<TContext extends OrganizationHostContext>(
  runtime: TrpcRuntime<TContext>,
) {
  const organizations = (ctx: TContext) => ctx.app.organizations;
  const person = {
    facts: [
      bindTrpcFact(organizationSessionPersonFact, (ctx: TContext) =>
        ctx.session?.user
          ? { name: ctx.session.user.name ?? null, email: ctx.session.user.email ?? null }
          : null,
      ),
    ],
  };

  return {
    organization: runtime.mount(organizationTrpcTransport, organizations, person),
    onboarding: runtime.mount(onboardingTrpcTransport, organizations, person),
    team: runtime.mount(teamTrpcTransport, organizations),
    group: runtime.mount(groupTrpcTransport, organizations),
    joinRequests: runtime.mount(joinRequestTrpcTransport, organizations),
    personalWorkspaceFeatures: runtime.mount(personalWorkspaceFeaturesTrpcTransport, organizations),
  };
}
