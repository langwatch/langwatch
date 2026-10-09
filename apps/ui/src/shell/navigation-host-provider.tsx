/**
 * Where the shell answers the navigation module's host port: one hook takes
 * every reading, one class holds the port's shape, and the module receives
 * only the port. The pattern every other `*HostApi` the shell implements copies.
 */

import { useUiAddress } from "@langwatch/browser-host/address";
import {
  useUiCapabilities,
  useUiDeployment,
  useUiRpc,
  useUiScope,
} from "@langwatch/browser-host/capabilities";
import type { UiDrawerToken } from "@langwatch/browser-host/declarations";
import { useDrawer } from "@langwatch/browser-host/drawer";
import {
  setGraphicsQualityOverride,
  useGraphicsQualityOverrideStore,
  type GraphicsQualityOverride,
} from "@langwatch/browser-host/facilities";
import { useUiFlags } from "@langwatch/browser-host/feature-flag";
import { routePatternOf } from "@langwatch/browser-host/navigation-tracing";
import { UiPageFailure, UiPageNotFound } from "@langwatch/browser/page-fallbacks";
import type { ProcessWebConfig } from "@langwatch/config/public-app-config";
import { LangyMark, LangyMarkGradientDefs } from "@langwatch/design-system/langy-mark";
import { LoadingScreen } from "@langwatch/design-system/loading-screen";
import type { NavigationScopeWrite, NavigationUser } from "@langwatch/navigation-contract";
import { useCallback, useMemo, type ReactNode } from "react";

import { useLangyStore } from "./behavior/langy/langy.store.ts";
import {
  browserNavigationHosts,
  type NavigationAccountMenu,
  type NavigationLangy,
} from "./navigation-host";
import { navigationDeploymentOf } from "./navigation-host-deployment";
import { offersLangyAsk, offersPresenceMenuItem, opsAccessOf } from "./navigation-host-gates";
import {
  openableTeamsOf,
  presenceFlagsOf,
  teamHoldingProject,
  toNavigationOrganizations,
  type NavigationGraphRead,
} from "./navigation-host-graph";
import type { UiRootCapabilities } from "./ui-root-capabilities";
import { useUiShellFailure } from "./ui-shell-failure";

/** The gradient the palette's own Langy mark paints with. */
const COMMAND_BAR_LANGY_GRADIENT_ID = "command-bar-langy-mark-gradient";

/** The shell's host class over navigation's port class, built once per loaded port. */
const browserHostClasses = new WeakMap<
  UiRootCapabilities["navigationHost"]["NavigationHost"],
  ReturnType<typeof browserNavigationHosts>
>();

function browserNavigationHostOf(port: UiRootCapabilities["navigationHost"]["NavigationHost"]) {
  const known = browserHostClasses.get(port);
  if (known) return known;
  const built = browserNavigationHosts(port);
  browserHostClasses.set(port, built);
  return built;
}

/** The port's scope write, in the shell's own storage vocabulary. */
function rememberScope({
  write,
  remember,
}: {
  write: NavigationScopeWrite;
  remember: UiRootCapabilities["scope"]["rememberUiScopeSelection"];
}): void {
  remember({
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
const GRAPHICS_QUALITY_LABELS: Record<GraphicsQualityOverride, string> = {
  auto: "Auto",
  on: "On",
  off: "Off",
};

function setGraphicsQualityFromMenu(value: string): void {
  if (value === "auto" || value === "on" || value === "off") setGraphicsQualityOverride(value);
}

export function UiNavigationHost({
  children,
  commandBar = false,
  capabilities,
  process,
}: {
  children: ReactNode;
  /** The process owner's slice, handed down by the chrome. */
  process: ProcessWebConfig;
  /** Auth's session and organization's scope, loaded before the shell rendered. */
  capabilities: UiRootCapabilities;
  /**
   * Whether this mount carries the search palette — a singleton (one
   * document, one Cmd+K), so only the chrome layout route asks for it.
   */
  commandBar?: boolean;
}) {
  const { host, failure } = useNavigationHostReading({ commandBar, capabilities, process });

  if (failure.departing) return <LoadingScreen />;
  if (failure.copy) {
    return (
      <UiPageFailure
        copy={failure.copy}
        retry={{ onRetry: () => window.location.reload(), testId: "retry-workspace" }}
      />
    );
  }

  const { NavigationHostProvider } = capabilities.navigationHost;
  const { CommandBarProvider } = capabilities.commandBar;
  return (
    <NavigationHostProvider value={host}>
      {commandBar ? <CommandBarProvider>{children}</CommandBarProvider> : children}
    </NavigationHostProvider>
  );
}

function useNavigationHostReading({
  commandBar,
  capabilities: {
    session: auth,
    scope: scopeCapability,
    organizationFacts,
    navigationHost,
    commandBar: palette,
    presenceMenuItem,
    impersonationBanner,
    upgradeBanner,
  },
  process,
}: {
  commandBar: boolean;
  capabilities: UiRootCapabilities;
  process: ProcessWebConfig;
}) {
  const { session, navigation, documentTitle, route } = useUiCapabilities();
  const activeScope = useUiScope().activeScope();
  const memory = scopeCapability.useUiScopeMemory();
  const facts = organizationFacts.useUiOrganizationFacts();
  const routeReading = scopeCapability.useUiRouteReading();
  const address = useUiAddress();
  const rpc = useUiRpc();
  const { openDrawer } = useDrawer();

  const organizations = scopeCapability.useUiOrganizations({
    transport: rpc,
    isDemo: false,
    enabled: true,
    userId: session.currentUser()?.id,
  });

  const failure = useUiShellFailure({
    error: organizations.error,
    fallbackTitle: "We couldn't open your workspace",
    isPublicRoute: routeReading.isPublicRoute,
    signInPath: auth.UI_SIGN_IN_PATH,
  });

  const read: NavigationGraphRead = useMemo(
    () => (organizations.data ?? []) as NavigationGraphRead,
    [organizations.data],
  );
  const graph = useMemo(() => toNavigationOrganizations(read), [read]);
  const organization = useMemo(
    () => graph.find((candidate) => candidate.id === activeScope.organizationId),
    [graph, activeScope.organizationId],
  );
  const organizationRole = useMemo(
    () =>
      scopeCapability.organizationRoleOf(read.find((one) => one.id === activeScope.organizationId)),
    [read, activeScope.organizationId, scopeCapability],
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
    () =>
      openableTeamsOf({
        organization,
        userId: currentUser?.id,
        organizationRole,
        teamRules: scopeCapability,
      }),
    [organization, currentUser?.id, organizationRole, scopeCapability],
  );

  const uiDeployment = useUiDeployment();
  const deployment = useMemo(
    () => navigationDeploymentOf({ deployment: uiDeployment, process }),
    [uiDeployment, process],
  );

  const flags = useUiFlags();
  const askLangy = useLangyStore((store) => store.askLangy);
  const setHomeAskOpen = useLangyStore((store) => store.setHomeAskOpen);
  const canAskLangy = offersLangyAsk({
    hasPermission: (permission) => session.hasPermission(permission),
    isFeatureEnabled: (flag) => flags.flag(flag) === true,
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
            shortcut: palette.getCommandBarShortcut(),
            open: palette.openCommandBar,
            trigger: <palette.CommandBarTrigger />,
          }
        : null,
    [commandBar, palette],
  );

  /** The address, split the way the chrome reads it. */
  const { pathname, search } = useMemo(() => {
    const withoutHash = address.split("#")[0] ?? "/";
    const queryAt = withoutHash.indexOf("?");
    if (queryAt === -1) return { pathname: withoutHash, search: "" };
    return { pathname: withoutHash.slice(0, queryAt), search: withoutHash.slice(queryAt) };
  }, [address]);

  const routePattern = routePatternOf(pathname, route.reading().params);

  // The header carries ops's impersonation banner whenever the session says so
  // (specs/auth/impersonation-banner.feature), else ops's operator upgrade banner,
  // which gates itself on ops:view. Presence is offered only on the
  // surface that broadcasts it, its switches off the graph already read.
  const graphicsQualityOverride = useGraphicsQualityOverrideStore();
  const accountMenu = useMemo<NavigationAccountMenu>(() => {
    const ImpersonationBanner = impersonationBanner.default;
    const UpgradeBanner = upgradeBanner.default;
    const headerBanner = currentUser?.impersonator ? (
      <ImpersonationBanner user={currentUser} />
    ) : (
      <UpgradeBanner />
    );
    const graphicsQuality = {
      value: graphicsQualityOverride,
      label: GRAPHICS_QUALITY_LABELS[graphicsQualityOverride],
      set: setGraphicsQualityFromMenu,
    };
    if (!offersPresenceMenuItem(routePattern)) return { headerBanner, graphicsQuality };
    const flags = presenceFlagsOf({
      read,
      organizationId: activeScope.organizationId,
      projectId: activeScope.projectId,
    });
    const PresenceMenuItem = presenceMenuItem.default;
    return { headerBanner, graphicsQuality, presence: <PresenceMenuItem {...flags} /> };
  }, [
    graphicsQualityOverride,
    routePattern,
    read,
    activeScope.organizationId,
    activeScope.projectId,
    presenceMenuItem,
    impersonationBanner,
    upgradeBanner,
    currentUser,
  ]);

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
  const openDrawerByToken = useCallback(
    <Props,>(drawer: UiDrawerToken<Props>, props?: Partial<Props>) => openDrawer(drawer, props),
    [openDrawer],
  );

  const host = useMemo(
    () =>
      browserNavigationHostOf(navigationHost.NavigationHost).create(
        {
          organizations: graph,
          organization,
          team,
          project,
          openableTeams,
          // The project comes off the scope, which settles after the session and
          // after this graph: until both have, a missing project is not a not-found.
          // specs/navigation/workspace-resolution.feature
          isLoading: organizations.isLoading || !session.isSettled(),
          currentUser,
          organizationRole,
          rememberedProjectSlug: memory.selection.projectSlug,
          pathname,
          search,
          projectParam: routeReading.projectParam,
          projectSlugFromAddress: scopeCapability.projectSlugAddressedBy(routeReading.projectParam),
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
          featureFlag: (flag) => flags.flag(flag),
        },
        {
          navigate: (to) => navigation.navigate(to),
          replace: (to) => navigation.replace(to),
          back: () => navigation.back(),
          rememberScope: (write: NavigationScopeWrite) =>
            rememberScope({ write, remember: scopeCapability.rememberUiScopeSelection }),
          signOut: () => void auth.signOutUi(),
          setDocumentTitle,
          openDrawer: openDrawerByName,
          openDrawerByToken,
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
      pathname,
      search,
      routeReading,
      routePattern,
      deployment,
      facts,
      session,
      flags,
      commandBarAnswer,
      langy,
      accountMenu,
      navigation,
      auth,
      scopeCapability,
      setDocumentTitle,
      openDrawerByName,
      openDrawerByToken,
      navigationHost,
    ],
  );

  return { host, failure };
}
