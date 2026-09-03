/**
 * What the personal-workspace screens are mounted inside: the tRPC Provider
 * their hooks run on, and the host port for session, org graph, deployment,
 * address and feedback — including the caller's own membership `role`.
 */

import {
  personalWorkspaceApi,
  PersonalWorkspaceHostProvider,
  type PersonalOrganization,
  type PersonalWorkspaceHostPort,
} from "@langwatch/user-web/screens/personal-workspace";
import { useMemo, type ReactNode } from "react";
import { readPublicAppConfig } from "../../../../behavior/public-config";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import {
  linkUiSignInMethod,
  listUiPasskeys,
  registerUiPasskey,
  removeUiPasskey,
  renameUiPasskey,
} from "../../../../behavior/ui-passkeys";
import { useRefreshUiSession } from "../../../../behavior/ui-session-refresh";
import {
  resolvePersonalWorkspaceOrganization,
  resolvePersonalWorkspaceProject,
} from "../../behavior/personal-workspace-scope-lookup";

/**
 * The deployment shape, read once. No config means a self-hosted
 * deployment with none stated, not a broken one — the install copy falls back to the CLI's own default.
 */
function readDeployment(): { isSaas: boolean; appBaseUrl: string; passkeysEnabled: boolean } {
  try {
    const config = readPublicAppConfig();
    return {
      isSaas: config.deployment === "saas",
      appBaseUrl: config.appBaseUrl,
      passkeysEnabled: config.passkeys,
    };
  } catch {
    // A shell with no configuration is a self-hosted one with no stated
    // address rather than a broken one. Passkeys read OFF there for the same
    // reason the section gates on the flag at all: offering a ceremony a
    // deployment never mounted an endpoint for is an offer we cannot honour.
    return { isSaas: false, appBaseUrl: "https://app.langwatch.ai", passkeysEnabled: false };
  }
}

export function PersonalWorkspaceHost({ children }: { children: ReactNode }) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const refreshSession = useRefreshUiSession();
  const scope = session.activeScope();
  const actor = session.currentUser();

  const organizations = personalWorkspaceApi.organization.getAll.useQuery({ isDemo: false });

  /** The graph, with each project stamped with its team id — the screens read a flat project and need it. */
  const organizationsWithTeamIds: readonly PersonalOrganization[] = useMemo(
    () =>
      (organizations.data ?? []).map((organization) => ({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        // The one field Settings > Authentication reads off the graph that no
        // other personal-workspace screen does: an organization pinned to a
        // single sign-on provider may not link additional methods.
        ssoProvider: organization.ssoProvider ?? null,
        teams: organization.teams.map((team) => ({
          id: team.id,
          name: team.name,
          projects: team.projects.map((project) => ({ ...project, teamId: team.id })),
        })),
      })),
    [organizations.data],
  );

  /** The reader's own role: `members` is narrowed to the caller, so the first row is theirs; `undefined` means still arriving, not "no role". */
  const organizationRole = useMemo(() => {
    const organizationId = scope.organizationId;
    if (!organizationId) return void 0;
    const organization = (organizations.data ?? []).find(
      (candidate) => candidate.id === organizationId,
    );
    return organization?.members[0]?.role;
  }, [organizations.data, scope.organizationId]);

  const reading = route.reading();

  const host = useMemo<PersonalWorkspaceHostPort>(
    () => ({
      scope: () => scope,
      organization: () =>
        resolvePersonalWorkspaceOrganization({
          organizationId: scope.organizationId,
          organizations: organizationsWithTeamIds,
        }),
      project: () =>
        resolvePersonalWorkspaceProject({
          projectId: scope.projectId,
          organizations: organizationsWithTeamIds,
        }),
      // "We have not looked yet" and "there is no project" are the same
      // absent project, and the two project-scoped screens must not report
      // the first as the second.
      isScopeResolved: () => organizations.isSuccess,
      currentUser: () =>
        actor ? { id: actor.id, name: actor.name, email: actor.email, image: actor.image } : null,
      organizationRole: () => organizationRole,
      hasPermission: (permission) => session.hasPermission(permission),
      isFeatureEnabled: (flag) => session.isFeatureEnabled(flag),
      deployment: () => readDeployment(),
      route: () => reading,
      setQuery: (next, options) => route.setQuery(next, options),
      navigate: (to) => navigation.navigate(to),
      refreshSession: () => refreshSession(),
      listPasskeys: () => listUiPasskeys(),
      registerPasskey: () => registerUiPasskey(),
      renamePasskey: (input) => renameUiPasskey(input),
      removePasskey: (input) => removeUiPasskey(input),
      // Back to the page the reader is standing on, so a linked method
      // lands them where they asked for it rather than at the product's
      // front door.
      linkSignInMethod: (provider) =>
        linkUiSignInMethod(provider, { callbackUrl: "/settings/authentication" }),
      succeeded: (notice) => feedback.succeeded(notice),
      failed: (failure) => feedback.failed(failure),
    }),
    [
      scope,
      actor,
      organizationsWithTeamIds,
      organizationRole,
      organizations.isSuccess,
      reading,
      refreshSession,
      session,
      route,
      navigation,
      feedback,
    ],
  );

  return <PersonalWorkspaceHostProvider value={host}>{children}</PersonalWorkspaceHostProvider>;
}
