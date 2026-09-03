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
 * `organization.getAll` is asked with the same input the application shell asks
 * with, which under tRPC's path-plus-input cache key is the same entry: the
 * graph is fetched once for the document however many halves of the product want
 * it. THE READ IS ENABLED UNCONDITIONALLY, which matters on these addresses in a
 * way it does not elsewhere — `/onboarding/welcome` decides whether to show the
 * create-an-organization form from whether the reader belongs to one, and an
 * answer that never arrives shows it to a member.
 *
 * `revealProjectApiKey()` DOES NOT WIDEN THE SCOPE GRAPH: `UiScopeProject`
 * carries an id, a slug and a name and no credential. The key arrives as its own
 * reading off the same `organization.getAll` answer, redacted server-side by the
 * same `project:update` check that decides who may hold one at all — a reader
 * who may not gets `undefined`.
 */

import {
  OnboardingHostProvider,
  onboardingApi,
  type OnboardingHostPort,
  type OnboardingOrganization,
  type OnboardingSessionStatus,
} from "@langwatch/onboarding-web/screens/onboarding";
import { useMemo, type ReactNode } from "react";
import { useUiAddress } from "../../../../behavior/ui-address";
import { writeUiClipboard } from "../../../../behavior/ui-clipboard";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { uiLeaveTo } from "../../../../behavior/ui-departure";
import { copyToClipboard } from "../../behavior/onboarding-copy-to-clipboard";
import { useUiPrefersReducedMotion } from "../../../../behavior/ui-reduced-motion";
import { signOutUi } from "../../../../behavior/ui-session-client";

/** The address without its query string or fragment. */
function pathnameOf(address: string): string {
  const cut = address.search(/[?#]/);
  return cut === -1 ? address : address.slice(0, cut);
}

export function OnboardingHost({ children }: { children: ReactNode }) {
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

  // The active project, and — separately — its base key. See above: the key is
  // a reading of its own so the scope graph never carries a credential.
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

  const host = useMemo<OnboardingHostPort>(
    () => ({
      scope: () => ({
        organization,
        organizations: hostOrganizations,
        project: activeProject
          ? { id: activeProject.id, name: activeProject.name, slug: activeProject.slug }
          : void 0,
        isLoading: organizations.isLoading,
      }),
      currentUser: () => (actor ? { id: actor.id, email: actor.email ?? void 0 } : null),
      sessionStatus: () => sessionStatus,
      route: () => ({
        pathname: pathnameOf(address),
        asPath: address,
        params: reading.params,
        query: reading.query,
      }),
      navigate: (to) => navigation.navigate(to),
      replace: (to) => navigation.replace(to),
      // A whole new document, not a client transition. The welcome flow calls
      // this after minting an organization, and the reason is the cache: the
      // graph, the permissions and the flags this document holds were all read
      // before that organization existed. A route change would carry every one
      // of them into the first page of the product.
      hardRedirect: (to) => uiLeaveTo(to),
      setQuery: (next, options) => route.setQuery(next, options),
      featureFlag: (flag) => {
        const answer = session.featureFlag(flag);
        return { enabled: answer === true, isLoading: answer === void 0 };
      },
      signOut: () => void signOutUi(),
      succeeded: (notice) => feedback.succeeded(notice),
      failed: (failure) => feedback.failed(failure),
      copyToClipboard: ({ text, succeeded }) =>
        copyToClipboard({
          text,
          succeeded,
          writeClipboard: writeUiClipboard,
          onSucceeded: feedback.succeeded,
          onFailed: feedback.failed,
        }),
      // An empty string is what the server sends a reader who may not hold the
      // key; it is an absence rather than a key, and the screen renders it as one.
      revealProjectApiKey: () => activeProject?.apiKey || void 0,
      prefersReducedMotion: () => prefersReducedMotion,
    }),
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

export { onboardingApi };
