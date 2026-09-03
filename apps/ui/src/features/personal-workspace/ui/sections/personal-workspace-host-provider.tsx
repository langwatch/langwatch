/**
 * What the personal-workspace screens are mounted inside.
 *
 * Three things go around every `/me/*` page and the two project-scoped
 * coding-agent pages: the two tRPC Providers the package's hooks run on (its
 * own, and `@langwatch/coding-agent-web`'s, which its activity tables use), and
 * the host port that answers for the session, the organization graph, the
 * deployment, the address and the feedback. All of them are mounted here, once,
 * so a screen module stays a screen module.
 *
 * The reads live here rather than in the adapter for a reason worth keeping:
 * the adapter is a value object over what has already been read, so a test
 * constructs one, while a hook cannot be constructed at all.
 *
 * `organization.getAll` is asked with the same input the application shell asks
 * with, which under tRPC's path-plus-input cache key is the same entry: the
 * graph is fetched once for the document however many halves of the product
 * want it. This family reads one more thing off it than the gateway family
 * does — the caller's own membership row, which the read narrows to them, and
 * whose `role` is what tells a view-only member why their own workspace refuses
 * writes.
 */

import {
  personalWorkspaceApi,
  PersonalWorkspaceHostProvider,
  type PersonalOrganization,
} from "@langwatch/user-web/screens/personal-workspace";
import { useMemo, type ComponentType, type ReactNode } from "react";
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
import { UiPersonalWorkspaceHost } from "../../behavior/personal-workspace-host.adapter";

/**
 * The deployment shape, read once.
 *
 * A composition whose HTML shell carries no configuration is a self-hosted one
 * with no stated address rather than a broken one: the install copy then prints
 * the hosted application, which is the same fallback the CLI itself applies.
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

function PersonalWorkspaceHost({ children }: { children: ReactNode }) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const refreshSession = useRefreshUiSession();
  const scope = session.activeScope();
  const actor = session.currentUser();

  const organizations = personalWorkspaceApi.organization.getAll.useQuery({ isDemo: false });

  /**
   * The graph, with each project told which team it belongs to.
   *
   * `organization.getAll` nests projects under teams and so never repeats the
   * team id on a project row; the screens read a flat project and need it, so
   * it is stamped on here rather than asked for a second time.
   */
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

  /**
   * The reader's own standing in the organization they are scoped to.
   *
   * The read narrows `members` to the caller (and, on a demo organization, the
   * demo user), so the first row is theirs. Undefined while the graph is still
   * arriving, which is not the same as a member holding no elevated role — the
   * view-only notice reads it that way on purpose.
   */
  const organizationRole = useMemo(() => {
    const organizationId = scope.organizationId;
    if (!organizationId) return void 0;
    const organization = (organizations.data ?? []).find(
      (candidate) => candidate.id === organizationId,
    );
    return organization?.members[0]?.role;
  }, [organizations.data, scope.organizationId]);

  const reading = route.reading();
  const host = useMemo(
    () =>
      UiPersonalWorkspaceHost.create(
        {
          scope,
          organizations: organizationsWithTeamIds,
          organizationRole,
          // "We have not looked yet" and "there is no project" are the same
          // absent project, and the two project-scoped screens must not report
          // the first as the second.
          isScopeResolved: organizations.isSuccess,
          currentUser: actor
            ? { id: actor.id, name: actor.name, email: actor.email, image: actor.image }
            : null,
          deployment: readDeployment(),
          route: reading,
        },
        {
          hasPermission: (permission) => session.hasPermission(permission),
          isFeatureEnabled: (flag) => session.isFeatureEnabled(flag),
          setQuery: (next, options) => route.setQuery(next, options),
          navigate: (to) => navigation.navigate(to),
          refreshSession,
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
        },
      ),
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

/** Wraps one personal-workspace screen in the host its package asks for. */
export function withPersonalWorkspaceHost<P extends object>(
  Screen: ComponentType<P>,
): ComponentType<P> {
  const Mounted = (props: P) => (
    <PersonalWorkspaceHost>
      <Screen {...props} />
    </PersonalWorkspaceHost>
  );
  Mounted.displayName = `withPersonalWorkspaceHost(${Screen.displayName ?? Screen.name ?? "Screen"})`;
  return Mounted;
}
