/**
 * Where the shell answers the navigation module's host port: one hook takes
 * every reading, one class holds the port's shape, and the module receives
 * only the port. The pattern every other `*HostApi` the shell implements copies.
 */

import { trpcQueryKey } from "@langwatch/api/web";
import { signOutUi } from "@langwatch/auth-browser/session";
import { useUiAddress } from "@langwatch/browser-host/address";
import { useUiCapabilities, useUiRpc, useUiScope } from "@langwatch/browser-host/capabilities";
import { useDrawer } from "@langwatch/browser-host/drawer";
import { routePatternOf } from "@langwatch/browser-host/navigation-tracing";
import { LoadingScreen } from "@langwatch/design-system/loading-screen";
import { LangyMark, LangyMarkGradientDefs, useLangyStore } from "@langwatch/langy-browser-kit";
import {
  NavigationHostProvider,
  type NavigationAccountMenu,
  type NavigationLangy,
  type NavigationScopeWrite,
  type NavigationUser,
} from "@langwatch/navigation-browser/navigation";
import {
  CommandBarProvider,
  CommandBarTrigger,
  getCommandBarShortcut,
  openCommandBar,
} from "@langwatch/navigation-browser/surfaces/command-bar";
import {
  UI_ORGANIZATIONS_PROCEDURE,
  useUiOrganizationFacts,
} from "@langwatch/organization-browser/surfaces/organization-facts";
import {
  organizationRoleOf,
  rememberUiScopeSelection,
  useUiRouteReading,
  useUiScopeMemory,
} from "@langwatch/organization-browser/surfaces/scope-capability";
import { useLegacySimulationsPreference } from "@langwatch/scenario-browser/surfaces/simulations-preference";
import { PresenceMenuItem } from "@langwatch/trace-browser/surfaces/presence-menu-item";
import { UiPageFailure, UiPageNotFound } from "@langwatch/ui-kernel/page-fallbacks";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, type ReactNode } from "react";

import { BrowserNavigationHost } from "./navigation-host";
import { readNavigationDeployment } from "./navigation-host-deployment";
import { offersLangyAsk, offersPresenceMenuItem, opsAccessOf } from "./navigation-host-gates";
import {
  openableTeamsOf,
  presenceFlagsOf,
  teamHoldingProject,
  toNavigationOrganizations,
  type NavigationGraphRead,
} from "./navigation-host-graph";
import { useUiShellFailure } from "./ui-shell-failure";

/** The gradient the palette's own Langy mark paints with. */
const COMMAND_BAR_LANGY_GRADIENT_ID = "command-bar-langy-mark-gradient";

const ORGANIZATIONS_INPUT = { isDemo: false };

/** The port's scope write, in the shell's own storage vocabulary. */
function rememberScope(write: NavigationScopeWrite): void {
  rememberUiScopeSelection({
    writes: [
      ...(write.organizationId !== void 0
        ? [{ key: "organizationId" as const, value: write.organizationId }]
        : []),
      ...(write.projectSlug !== void 0
        ? [{ key: "projectSlug" as const, value: write.projectSlug }]
        : []),
    ],
  });
}

/**
 * The chrome, mounted over a host. A refused workspace graph is a state, not
 * an empty one: every scope answer below is read off that one query, so
 * rendering the chrome around a refusal would leave it empty forever.
 */
export function UiNavigationHost({
  children,
  commandBar = false,
}: {
  children: ReactNode;
  /**
   * Whether this mount carries the search palette — a singleton (one
   * document, one Cmd+K), so only the chrome layout route asks for it.
   */
  commandBar?: boolean;
}) {
  const { host, failure } = useNavigationHostReading(commandBar);

  if (failure.departing) return <LoadingScreen />;
  if (failure.copy) {
    return (
      <UiPageFailure
        copy={failure.copy}
        retry={{ onRetry: () => window.location.reload(), testId: "retry-workspace" }}
      />
    );
  }

  return (
    <NavigationHostProvider value={host}>
      {commandBar ? <CommandBarProvider>{children}</CommandBarProvider> : children}
    </NavigationHostProvider>
  );
}

function useNavigationHostReading(commandBar: boolean) {
  const { session, navigation, documentTitle, route } = useUiCapabilities();
  const activeScope = useUiScope().activeScope();
  const memory = useUiScopeMemory();
  const facts = useUiOrganizationFacts();
  const routeReading = useUiRouteReading();
  const address = useUiAddress();
  const rpc = useUiRpc();
  const { openDrawer } = useDrawer();

  const organizations = useQuery({
    queryKey: trpcQueryKey(UI_ORGANIZATIONS_PROCEDURE, {
      input: ORGANIZATIONS_INPUT,
      type: "query",
    }),
    queryFn: () =>
      rpc.query(UI_ORGANIZATIONS_PROCEDURE, ORGANIZATIONS_INPUT) as Promise<NavigationGraphRead>,
  });

  const failure = useUiShellFailure({
    error: organizations.error,
    fallbackTitle: "We couldn't open your workspace",
  });

  const read: NavigationGraphRead = useMemo(() => organizations.data ?? [], [organizations.data]);
  const graph = useMemo(() => toNavigationOrganizations(read), [read]);
  const organization = useMemo(
    () => graph.find((candidate) => candidate.id === activeScope.organizationId),
    [graph, activeScope.organizationId],
  );
  const organizationRole = useMemo(
    () => organizationRoleOf(read.find((one) => one.id === activeScope.organizationId)),
    [read, activeScope.organizationId],
  );
  const team = useMemo(
    () => teamHoldingProject(graph, activeScope.projectId),
    [graph, activeScope.projectId],
  );
  const project = useMemo(
    () => team?.projects.find((entry) => entry.id === activeScope.projectId),
    [team, activeScope.projectId],
  );

  const actor = session.currentUser();
  const currentUser: NavigationUser | undefined = useMemo(
    () => (actor ? { ...actor } : void 0),
    [actor],
  );
  const openableTeams = useMemo(
    () => openableTeamsOf({ organization, userId: currentUser?.id, organizationRole }),
    [organization, currentUser?.id, organizationRole],
  );

  const deployment = useMemo(readNavigationDeployment, []);

  // THE MENU'S ONE SCENARIO-OWNED READING. The preference is the scenario
  // family's and the Test section the navigation package's; neither browser
  // package may name the other, so the application reads it and answers.
  const prefersPreviousSimulationsScreens = useLegacySimulationsPreference(project?.id);

  const askLangy = useLangyStore((store) => store.askLangy);
  const setHomeAskOpen = useLangyStore((store) => store.setHomeAskOpen);
  const canAskLangy = offersLangyAsk({
    hasPermission: (permission) => session.hasPermission(permission),
    isFeatureEnabled: (flag) => session.isFeatureEnabled(flag),
    projectSlug: project?.slug,
    demoProjectSlug: deployment.demoProjectSlug,
  });
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
   * `open` uses the package's module-scope control, not its context: this
   * object is built ABOVE the provider that would answer the context.
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

  /** The address, split the way the chrome reads it. */
  const { pathname, search } = useMemo(() => {
    const withoutHash = address.split("#")[0] ?? "/";
    const queryAt = withoutHash.indexOf("?");
    if (queryAt === -1) return { pathname: withoutHash, search: "" };
    return { pathname: withoutHash.slice(0, queryAt), search: withoutHash.slice(queryAt) };
  }, [address]);

  const routePattern = routePatternOf(pathname, route.reading().params);

  // THE ACCOUNT DROPDOWN'S ONE ADDITION: presence, offered only on the
  // surface that broadcasts it. The switches come off the graph already read,
  // so the row and the lens read the same two facts.
  const accountMenu = useMemo<NavigationAccountMenu | null>(() => {
    if (!offersPresenceMenuItem(routePattern)) return null;
    const flags = presenceFlagsOf({
      read,
      organizationId: activeScope.organizationId,
      projectId: activeScope.projectId,
    });
    return { presence: <PresenceMenuItem {...flags} /> };
  }, [routePattern, read, activeScope.organizationId, activeScope.projectId]);

  const setDocumentTitle = useCallback(
    (title: string) => documentTitle.set(title),
    [documentTitle],
  );
  const openDrawerByName = useCallback(
    (drawer: string, params?: Record<string, string>) => {
      openDrawer(drawer, params ?? {});
    },
    [openDrawer],
  );

  const host = useMemo(
    () =>
      BrowserNavigationHost.create(
        {
          organizations: graph,
          organization,
          team,
          project,
          openableTeams,
          // The graph is what every answer above is read off, so "still
          // arriving" is exactly this query being unsettled.
          isLoading: organizations.isLoading,
          currentUser,
          organizationRole,
          rememberedProjectSlug: memory.selection.projectSlug,
          prefersPreviousSimulationsScreens,
          pathname,
          search,
          projectParam: routeReading.projectParam,
          catchAllPath: routeReading.pathname.replace(/^\/@project\/?/, ""),
          routePattern,
          deployment,
          plan: {
            isEnterprise: facts.isEnterprise,
            isLoading: facts.isPlanLoading,
            isLiteMember: facts.isLiteMember,
          },
          opsAccess: opsAccessOf((permission) => session.hasPermission(permission)),
          commandBar: commandBarAnswer,
          langy,
          accountMenu,
          waiting: <LoadingScreen />,
          notFound: <UiPageNotFound />,
          hasPermission: (permission) => session.hasPermission(permission),
          featureFlag: (flag) => session.featureFlag(flag),
        },
        {
          navigate: (to) => navigation.navigate(to),
          replace: (to) => navigation.replace(to),
          back: () => navigation.back(),
          rememberScope,
          signOut: () => void signOutUi(),
          setDocumentTitle,
          openDrawer: openDrawerByName,
        },
      ),
    [
      graph,
      organization,
      team,
      project,
      openableTeams,
      organizations.isLoading,
      currentUser,
      organizationRole,
      memory.selection.projectSlug,
      prefersPreviousSimulationsScreens,
      pathname,
      search,
      routeReading,
      routePattern,
      deployment,
      facts,
      session,
      commandBarAnswer,
      langy,
      accountMenu,
      navigation,
      setDocumentTitle,
      openDrawerByName,
    ],
  );

  return { host, failure };
}
