/**
 * What the five onboarding screens are mounted inside.
 *
 * Two things go around them: the tRPC Provider the package's own hooks run on,
 * and the host port that answers for the organization graph, the session, the
 * address, the governance-fork flag, sign-out, the two notices, the clipboard,
 * the reduced-motion preference and the project's base key. THE DEPLOYMENT IS
 * NOT ON IT: the package decodes the public-config meta tag itself, because half
 * the modules that read it are also mounted by `@langwatch/trace-web`, which
 * mounts no onboarding host. A screen stays a screen module.
 *
 * The reads live here rather than in the adapter for a reason worth keeping: the
 * adapter is a value object over what has already been read, so a test
 * constructs one, while a hook cannot be constructed at all.
 *
 * `organization.getAll` is asked with the same input the application shell asks
 * with, which under tRPC's path-plus-input cache key is the same entry: the
 * graph is fetched once for the document however many halves of the product want
 * it. THE READ IS ENABLED UNCONDITIONALLY, which matters on these addresses in a
 * way it does not elsewhere — `/onboarding/welcome` decides whether to show the
 * create-an-organization form from whether the reader belongs to one, and an
 * answer that never arrives shows it to a member.
 */

import {
  OnboardingHostProvider,
  onboardingApi,
  type OnboardingOrganization,
  type OnboardingSessionStatus,
} from "@langwatch/onboarding-web/screens/onboarding";
import { useMemo, type ComponentType, type ReactNode } from "react";
import { useUiAddress } from "../../../../behavior/ui-address";
import { writeUiClipboard } from "../../../../behavior/ui-clipboard";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { uiLeaveTo } from "../../../../behavior/ui-departure";
import { useUiPrefersReducedMotion } from "../../../../behavior/ui-reduced-motion";
import { signOutUi } from "../../../../behavior/ui-session-client";
import { UiOnboardingHost } from "../../behavior/onboarding-host.adapter";

/** The address without its query string or fragment. */
function pathnameOf(address: string): string {
  const cut = address.search(/[?#]/);
  return cut === -1 ? address : address.slice(0, cut);
}

function OnboardingHost({ children }: { children: ReactNode }) {
  const { session, route, feedback, navigation } = useUiCapabilities();
  const activeScope = session.activeScope();
  const prefersReducedMotion = useUiPrefersReducedMotion();
  // The whole address, from the seam that keeps `react-router` out of a feature.
  const address = useUiAddress();

  const organizations = onboardingApi.organization.getAll.useQuery({ isDemo: false });
  const graph = organizations.data;

  const hostOrganizations = useMemo<readonly OnboardingOrganization[] | undefined>(
    () =>
      graph?.map((entry) => ({
        id: entry.id,
        name: entry.name,
        primaryIntent: entry.primaryIntent,
        teams: entry.teams.map((team) => ({
          id: team.id,
          name: team.name,
          isPersonal: Boolean(team.isPersonal),
          projects: team.projects.map((project) => ({
            id: project.id,
            name: project.name,
            slug: project.slug,
          })),
        })),
      })),
    [graph],
  );

  const organization = useMemo(
    () => hostOrganizations?.find((candidate) => candidate.id === activeScope.organizationId),
    [hostOrganizations, activeScope.organizationId],
  );

  // The active project, and — separately — its base key. See the adapter's
  // docblock: the key is a reading of its own so the scope graph never carries a
  // credential.
  const activeProject = useMemo(() => {
    if (!activeScope.projectId) return void 0;
    for (const entry of graph ?? []) {
      for (const team of entry.teams) {
        const project = team.projects.find((candidate) => candidate.id === activeScope.projectId);
        if (project) return project;
      }
    }
    return void 0;
  }, [graph, activeScope.projectId]);

  const actor = session.currentUser();
  const sessionStatus: OnboardingSessionStatus = actor
    ? "authenticated"
    : session.isSettled()
      ? "unauthenticated"
      : "loading";

  const reading = route.reading();

  const host = useMemo(
    () =>
      UiOnboardingHost.create(
        {
          scope: {
            organization,
            organizations: hostOrganizations,
            project: activeProject
              ? {
                  id: activeProject.id,
                  name: activeProject.name,
                  slug: activeProject.slug,
                }
              : void 0,
            isLoading: organizations.isLoading,
          },
          currentUser: actor ? { id: actor.id, email: actor.email ?? void 0 } : null,
          sessionStatus,
          route: {
            pathname: pathnameOf(address),
            asPath: address,
            params: reading.params,
            query: reading.query,
          },
          projectApiKey: activeProject?.apiKey ?? void 0,
          prefersReducedMotion,
        },
        {
          navigate: (to) => navigation.navigate(to),
          replace: (to) => navigation.replace(to),
          leaveTo: uiLeaveTo,
          setQuery: (next, options) => route.setQuery(next, options),
          featureFlag: (flag) => {
            const answer = session.featureFlag(flag);
            return { enabled: answer === true, isLoading: answer === void 0 };
          },
          signOut: () => void signOutUi(),
          succeeded: (notice) => feedback.succeeded(notice),
          failed: (failure) => feedback.failed(failure),
          writeClipboard: writeUiClipboard,
        },
      ),
    [
      organization,
      hostOrganizations,
      activeProject,
      organizations.isLoading,
      actor,
      sessionStatus,
      reading,
      address,
      prefersReducedMotion,
      navigation,
      route,
      session,
      feedback,
    ],
  );

  return <OnboardingHostProvider value={host}>{children}</OnboardingHostProvider>;
}

/** Wraps an onboarding screen in the host its package asks for. */
export function withOnboardingHost<P extends object>(
  Screen: ComponentType<P>,
): ComponentType<P> {
  const Mounted = (props: P) => (
    <OnboardingHost>
      <Screen {...props} />
    </OnboardingHost>
  );
  Mounted.displayName = `withOnboardingHost(${Screen.displayName ?? Screen.name ?? "Screen"})`;
  return Mounted;
}

export { onboardingApi };
