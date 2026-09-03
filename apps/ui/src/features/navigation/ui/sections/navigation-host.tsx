/**
 * What the navigation package's screens and the application chrome are mounted
 * inside.
 *
 * Two things go around them: the tRPC Provider the package's own hooks run on,
 * and the host port that answers for the workspace graph, the reader, the
 * grants, the flags, the deployment, this device's scope memory and the
 * navigations.
 *
 * `organization.getAll` is asked with the same input the application shell asks
 * with, which under tRPC's path-plus-input cache key is the same entry: the
 * graph is fetched once for the document however many halves of the product want
 * it.
 *
 * WHICH TEAMS THE READER MAY OPEN is this application's own policy, and it is
 * already written down once, in `behavior/ui-scope-resolution`. The port asks
 * for the answer rather than the rules, so the switcher, the LLM Ops home and
 * the chrome offer exactly the teams a page would render for.
 */

import {
  navigationApi,
  NavigationHostProvider,
  type NavigationDeployment,
  type NavigationHostPort,
  type NavigationLangy,
  type NavigationOrganization,
  type NavigationTeam,
  type NavigationUser,
} from "@langwatch/navigation-web/screens/landing";
import {
  CommandBarProvider,
  CommandBarTrigger,
  getCommandBarShortcut,
  openCommandBar,
} from "@langwatch/navigation-web/command-bar";
import { LangyMark, LangyMarkGradientDefs, useLangyStore } from "@langwatch/langy-web";
import { useDrawer } from "@langwatch/ui-drawer";
import { useCallback, useMemo, type ReactNode } from "react";
import { readPublicAppConfig } from "../../../../behavior/public-config";
import { useUiAddress } from "../../../../behavior/ui-address";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { useUiOrganizationFacts } from "../../../../behavior/ui-organization-facts";
import { selectAmbientTeam, userCanOpenTeam } from "../../../../behavior/ui-scope-resolution";
import { useUiScopeMemory } from "../../../../behavior/ui-scope-storage";
import { signOutUi } from "../../../../behavior/ui-session-client";
import { useUiRouteReading } from "../../../../behavior/ui-scope-route";
import { UiPageLoading } from "../../../../ui/elements/ui-page-fallbacks";
import { readNavigationFeatureFlag } from "../../behavior/navigation-feature-flag";
import { rememberNavigationScope } from "../../behavior/navigation-remember-scope";

/** The two grants that decide how far a reader gets into the operations pages. */
const OPS_VIEW_PERMISSION = "ops:view";
const OPS_MANAGE_PERMISSION = "ops:manage";

/**
 * The grant that STARTS a Langy turn, and the rollout that reveals Langy at all.
 *
 * `langy:view` is the read grant the panel needs; `langy:create` is what a
 * hand-off from the palette needs, because the hand-off queues a prompt that
 * auto-sends. Offering the hand-off on the read grant would be an invitation
 * into a 403, so the palette is told "no assistant" rather than "an assistant
 * you may not talk to".
 */
const LANGY_CREATE_PERMISSION = "langy:create";
const LANGY_RELEASE_FLAG = "release_langy_enabled";

/** The gradient the palette's own Langy mark paints with. */
const COMMAND_BAR_LANGY_GRADIENT_ID = "command-bar-langy-mark-gradient";

/** The organization graph, narrowed to what the navigation package reads. */
type OrganizationsRead = ReadonlyArray<{
  id: string;
  name: string;
  members?: Array<{ role: string }>;
  teams: Array<{
    id: string;
    name: string;
    isPersonal?: boolean | null;
    ownerUserId?: string | null;
    members?: Array<{ userId: string }>;
    projects: Array<{
      id: string;
      name: string;
      slug: string;
      lastCodingAgentSessionAt?: string | Date | null;
      lastCodingAgentPullRequestAt?: string | Date | null;
    }>;
  }>;
}>;

/**
 * The graph, in the navigation package's own vocabulary.
 *
 * A narrowing rather than a translation: every field below is already on the
 * procedure's answer, and the ones this application carries and the package does
 * not (slugs on teams, owner ids on projects) simply do not travel.
 */
function toNavigationOrganizations(organizations: OrganizationsRead): NavigationOrganization[] {
  return organizations.map((organization) => ({
    id: organization.id,
    name: organization.name,
    teams: organization.teams.map((team) => ({
      id: team.id,
      name: team.name,
      isPersonal: team.isPersonal,
      ownerUserId: team.ownerUserId,
      members: team.members,
      projects: team.projects.map((project) => ({
        id: project.id,
        name: project.name,
        slug: project.slug,
        isPersonal: team.isPersonal,
        lastCodingAgentSessionAt: project.lastCodingAgentSessionAt,
        lastCodingAgentPullRequestAt: project.lastCodingAgentPullRequestAt,
      })),
    })),
  }));
}

/**
 * What kind of deployment this is, off the config the HTML shell carries.
 *
 * A composition whose document has no config block is a self-hosted deployment
 * as far as every branch below goes, never a crash — the same shape
 * `readUiIsSaaS` takes for the same reason.
 */
function readDeployment(): NavigationDeployment {
  try {
    const config = readPublicAppConfig();
    return {
      isSaaS: config.deployment === "saas",
      isDevelopment: config.mode === "development",
      ...(config.demoProjectSlug ? { demoProjectSlug: config.demoProjectSlug } : {}),
      hasNlpService: config.capabilities.nlp,
      hasLangevals: config.capabilities.langevals,
    };
  } catch {
    return {
      isSaaS: false,
      isDevelopment: false,
      // A document with no config makes no claim about the analysis services,
      // and warning that two environment variables are unset on the strength
      // of a missing config block would be a false alarm on every test mount.
      hasNlpService: true,
      hasLangevals: true,
    };
  }
}

/**
 * Mounts the host above whatever it wraps.
 *
 * Exported because the CHROME mounts it once, above the outlet, rather than
 * once per screen: the switchers in the header, the sidebar and the screen
 * below them have to be looking at the same workspace graph, and one provider
 * is what makes them.
 */
export function NavigationHostSection({
  children,
  commandBar = false,
}: {
  children: ReactNode;
  /**
   * Whether this mount is the one that carries the search palette.
   *
   * THE PALETTE IS A SINGLETON — one document, one Cmd+K, one dialog — and
   * this section is mounted in two places: once by the chrome layout route,
   * above every page this application serves, and once per screen for the
   * three addresses that sit OUTSIDE that layout. Mounting the provider
   * unconditionally would put two dialogs on any page where those nest. So the
   * chrome asks for it and nothing else does, and the host's `commandBar()`
   * answers `null` wherever it was not asked for — which is the same honest
   * answer it gave while the palette was still in `platform/app`: no Quick
   * Search row, no header trigger.
   */
  commandBar?: boolean;
}) {
  const { session, navigation, documentTitle } = useUiCapabilities();
  const activeScope = session.activeScope();
  const memory = useUiScopeMemory();
  const facts = useUiOrganizationFacts();
  const routeReading = useUiRouteReading();
  const address = useUiAddress();

  const organizations = navigationApi.organization.getAll.useQuery({ isDemo: false });

  const graph = useMemo(
    () => toNavigationOrganizations((organizations.data ?? []) as OrganizationsRead),
    [organizations.data],
  );

  const organization = useMemo(
    () => graph.find((candidate) => candidate.id === activeScope.organizationId),
    [graph, activeScope.organizationId],
  );

  /**
   * The reader's role in the resolved organization.
   *
   * `organization.getAll` narrows `members` to the caller's own row, so the
   * first one IS the reader's membership. Read off the raw answer rather than
   * the narrowed graph, which deliberately does not carry memberships.
   */
  const organizationRole = useMemo(
    () =>
      ((organizations.data ?? []) as OrganizationsRead).find(
        (candidate) => candidate.id === activeScope.organizationId,
      )?.members?.[0]?.role,
    [organizations.data, activeScope.organizationId],
  );

  /** The team that holds the project on screen, which is where the chrome's
   * personal-workspace test and the cross-scope banner both read from. */
  const team = useMemo(() => {
    if (!activeScope.projectId) return void 0;
    for (const candidate of graph) {
      const found = candidate.teams.find((entry) =>
        entry.projects.some((project) => project.id === activeScope.projectId),
      );
      if (found) return found;
    }
    return void 0;
  }, [graph, activeScope.projectId]);

  const project = useMemo(
    () => team?.projects.find((entry) => entry.id === activeScope.projectId),
    [team, activeScope.projectId],
  );

  const actor = session.currentUser();
  const currentUser: NavigationUser | undefined = useMemo(
    () => (actor ? { ...actor } : void 0),
    [actor],
  );
  const currentUserId = actor?.id;

  /**
   * The teams this reader may open, in the order the shell resolves an ambient
   * one: the ambient team first, then the rest of what they can reach.
   */
  const openableTeams: readonly NavigationTeam[] = useMemo(() => {
    const teams = organization?.teams ?? [];
    const reachable = teams.filter((candidate) =>
      userCanOpenTeam({ team: candidate, userId: currentUserId, organizationRole }),
    );
    const ambient = selectAmbientTeam({ teams: reachable, userId: currentUserId });
    if (!ambient) return reachable;
    return [ambient, ...reachable.filter((candidate) => candidate.id !== ambient.id)];
  }, [organization, currentUserId, organizationRole]);

  const deployment = useMemo(readDeployment, []);

  /**
   * The assistant, as the palette's hand-off needs it: may this reader start a
   * turn, the way to hand a question over, the way to tell a minimised panel to
   * stand down while an inline field is in use, and the mark the composer
   * draws. `null` is the gate — see the two constants above.
   */
  const askLangy = useLangyStore((store) => store.askLangy);
  const setHomeAskOpen = useLangyStore((store) => store.setHomeAskOpen);
  const canAskLangy =
    session.hasPermission(LANGY_CREATE_PERMISSION) &&
    session.featureFlag(LANGY_RELEASE_FLAG) === true;
  const langy: NavigationLangy | null = useMemo(
    () =>
      canAskLangy
        ? {
            ask: askLangy,
            setHomeAskOpen,
            mark: (
              <>
                <LangyMarkGradientDefs id={COMMAND_BAR_LANGY_GRADIENT_ID} />
                <LangyMark size={23} gradientId={COMMAND_BAR_LANGY_GRADIENT_ID} />
              </>
            ),
          }
        : null,
    [canAskLangy, askLangy, setHomeAskOpen],
  );

  /**
   * The palette's two shell entries, and the door into it.
   *
   * `open` goes through the package's own module-scope control rather than its
   * context, because this object is built ABOVE the provider that owns the
   * state — the provider asks this host who the reader is. The trigger is a
   * node, so it reads the context at the point the top bar draws it.
   */
  const commandBarAnswer = useMemo(
    () =>
      commandBar
        ? {
            shortcut: getCommandBarShortcut(),
            open: openCommandBar,
            trigger: <CommandBarTrigger />,
          }
        : null,
    [commandBar],
  );

  /** Opening a drawer is an ADDRESS, resolved against this application's registry. */
  const { openDrawer } = useDrawer();
  const openDrawerByName = useCallback(
    (drawer: string, params?: Record<string, string>) => {
      openDrawer(drawer, params ?? {});
    },
    [openDrawer],
  );

  /** The address, split the way the chrome reads it. */
  const [pathname = "/", search = ""] = useMemo(() => {
    const withoutHash = address.split("#")[0] ?? "";
    const queryAt = withoutHash.indexOf("?");
    return queryAt === -1
      ? [withoutHash, ""]
      : [withoutHash.slice(0, queryAt), withoutHash.slice(queryAt)];
  }, [address]);

  /**
   * The segments a catch-all captured, joined.
   *
   * `/@project/<rest>` is the only address that asks, and React Router hands
   * the rest of the path back under the `*` parameter.
   */
  const catchAllPath = routeReading.pathname.replace(/^\/@project\/?/, "");

  const setDocumentTitle = useCallback(
    (title: string) => documentTitle.set(title),
    [documentTitle],
  );
  const signOut = useCallback(() => {
    void signOutUi();
  }, []);

  const host = useMemo<NavigationHostPort>(
    () => ({
      organizations: () => graph,
      organization: () => organization,
      project: () => project,
      team: () => team,
      openableTeams: () => openableTeams,
      // The graph is what every answer above is read off, so "still
      // arriving" is exactly this query being unsettled.
      isLoading: () => organizations.isLoading,
      currentUser: () => currentUser,
      currentUserId: () => currentUser?.id,
      organizationRole: () => organizationRole,
      rememberedProjectSlug: () => memory.selection.projectSlug,
      waiting: () => <UiPageLoading />,
      notFound: () => <UiPageLoading />,
      pathname: () => pathname,
      search: () => search,
      projectParam: () => routeReading.projectParam,
      catchAllPath: () => catchAllPath,
      deployment: () => deployment,
      plan: () => ({
        isEnterprise: facts.isEnterprise,
        isLoading: facts.isPlanLoading,
        isLiteMember: facts.isLiteMember,
      }),
      opsAccess: () => ({
        hasAccess: session.hasPermission(OPS_VIEW_PERMISSION),
        isAdmin: session.hasPermission(OPS_MANAGE_PERMISSION),
      }),
      // THE SEARCH PALETTE, ANSWERED FOR REAL: `null` before this provider has
      // mounted with `commandBar`, the same honest answer this returned while
      // the palette was still in `platform/app`.
      commandBar: () => commandBarAnswer,
      langy: () => langy,
      hasPermission: (permission) => session.hasPermission(permission),
      featureFlag: (flag) => readNavigationFeatureFlag({ answer: session.featureFlag(flag) }),
      replace: (to) => navigation.replace(to),
      navigate: (to) => navigation.navigate(to),
      back: () => navigation.back(),
      rememberScope: rememberNavigationScope,
      signOut,
      setDocumentTitle,
      // Opens a drawer by name against this application's composed registry.
      // The command catalogue names other families' drawers; none of them is
      // the navigation package's to import, and none has to be — the
      // catalogue carries the name, `installed-ui-drawers` carries the
      // components, and this is where the two meet.
      openDrawer: openDrawerByName,
      // NO LIVE-CHAT BUBBLE. The Crisp script is loaded by `platform/app`, and
      // this application does not carry it, so the Support menu offers the
      // community and documentation entries and no "Chat with a human".
      supportChat: () => null,
      // NOTHING ADDED TO THE ACCOUNT DROPDOWN YET. The three things the
      // platform menu put there are all other halves' property: the
      // experiments dialog is `@langwatch/feature-flag-web`, the
      // impersonation banner and switch-back entry are `@langwatch/ops-web`,
      // and the reduced-graphics override is a `platform/app` store. Each
      // becomes a node here when its family is composed on this side.
      accountMenu: () => null,
    }),
    [
      graph,
      organization,
      project,
      team,
      openableTeams,
      organizations.isLoading,
      currentUser,
      organizationRole,
      memory,
      pathname,
      search,
      routeReading.projectParam,
      catchAllPath,
      deployment,
      facts,
      session,
      navigation,
      signOut,
      setDocumentTitle,
      commandBarAnswer,
      langy,
      openDrawerByName,
    ],
  );

  return (
    <NavigationHostProvider value={host}>
      {commandBar ? <CommandBarProvider>{children}</CommandBarProvider> : children}
    </NavigationHostProvider>
  );
}

export { navigationApi };
