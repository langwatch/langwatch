import {
  Box,
  Button,
  HStack,
  Portal,
  type StackProps,
  Text,
  useBreakpointValue,
} from "@chakra-ui/react";
import { Activity, ChevronDown, ChevronRight, Info, Plus } from "lucide-react";
import React, { useLayoutEffect, useState } from "react";
import { useLocalStorage } from "usehooks-ts";
import { NotFoundScene } from "~/components/NotFoundScene";
import {
  APP_HEADER_HEIGHT,
  LANGY_DOCK_GAP,
  LANGY_DOCKED_OFFSET,
  LANGY_TRANSITION,
} from "@langwatch/langy-web";
import { useLangyStore } from "@langwatch/langy-web";
import {
  type Organization,
  OrganizationUserRole,
  type Project,
  type Team,
} from "~/generated/prisma/client";
import Head from "~/utils/compat/next-head";
import { useRouter } from "~/utils/compat/next-router";
import { ImpersonationBanner } from "@langwatch/ops-web";
import { CommandBarTrigger } from "../features/command-bar";
import { NavigationV2Shell } from "../features/navigation/shell/NavigationV2Shell";
import { useNavigationMode } from "../features/navigation/useNavigationMode";
import { isNavigationV2ShellRoute } from "../features/navigation/useNavigationV2ShellActive";
import { useDrawer } from "../hooks/useDrawer";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { useOrgQueryParamSelection } from "../hooks/useOrgQueryParamSelection";
import { usePostHogIdentify } from "../hooks/usePostHogIdentify";
import { usePublicEnv } from "../hooks/usePublicEnv";
import { useRequiredSession } from "../hooks/useRequiredSession";
import type { FullyLoadedOrganization } from "../server/app-layer/organizations/repositories/organization.repository";
import { api } from "../utils/api";
import {
  buildProjectSwitchHref,
  findCurrentRoute,
  projectRoutes,
  type Route,
} from "../utils/routes";
import { AppHeaderUserMenu } from "./AppHeaderUserMenu";
import { DashboardPageBody } from "./DashboardPageBody";
import { FullLogo } from "./icons/FullLogo";
import { LogoIcon } from "./icons/LogoIcon";
import { LoadingScreen } from "./LoadingScreen";
import { MainMenu, MENU_WIDTH_COMPACT, MENU_WIDTH_EXPANDED } from "./MainMenu";
import { PasskeyNudge } from "./me/PasskeyNudge";
import { PersonalSidebar } from "./PersonalSidebar";
import { ProjectAvatar } from "./ProjectAvatar";
import { DevBadge } from "./ui/DevBadge";
import { Link } from "./ui/link";
import { Menu } from "@langwatch/design-system/menu";
import { useWorkspaceData } from "./useWorkspaceData";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

const Breadcrumbs = ({ currentRoute }: { currentRoute: Route | undefined }) => {
  // No redirects from the breadcrumb path - it only reads `project` for the
  // dashboard link. The owning DashboardLayout call handles bouncing.
  const { project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });

  if (!currentRoute) return null;

  return (
    <HStack gap={2} fontSize="13px" color="fg.muted" alignItems="center">
      <ChevronRight width="12" style={{ minWidth: "12px" }} />
      <Link href={`/${project?.slug ?? ""}`}>Dashboard</Link>
      {currentRoute.parent && (
        <>
          <ChevronRight width="12" style={{ minWidth: "12px" }} />
          <Link
            href={projectRoutes[currentRoute.parent].path.replace(
              "[project]",
              project?.slug ?? "",
            )}
          >
            {projectRoutes[currentRoute.parent].title}
          </Link>
        </>
      )}
      {currentRoute.title !== "Home" && (
        <>
          <ChevronRight width="12" style={{ minWidth: "12px" }} />
          <Text color="fg.muted" whiteSpace="nowrap">
            {currentRoute.title}
          </Text>
        </>
      )}
    </HStack>
  );
};

/**
 * Header chip rendered on personal-scope routes (`/me`, `/me/configure`).
 * Pinned to `current = personal` so the trigger always reads "My
 * Workspace" inside the personal-scope chrome, regardless of URL.
 *
 * Spec: specs/ai-gateway/governance/persona-aware-chrome.feature
 */
const PersonalScopeHeaderSwitcher = React.memo(function PersonalScopeHeaderSwitcher() {
  const data = useWorkspaceData();
  return <WorkspaceSwitcher {...data} current={{ kind: "personal" }} />;
});

/**
 * Header chip rendered on project-scope routes (`/[project]/*`,
 * `/settings/*`, `/governance/*`). Same `<WorkspaceSwitcher>` component
 * as the personal-scope chrome - the only switcher in the app - with
 * `current` auto-derived from the URL via `useWorkspaceCurrent`. The
 * legacy `<ProjectSelector>` was a separate component with overlapping
 * but inconsistent UX (different drop list, different context grouping,
 * different copy); having two switchers in different parts of the app
 * was the root cause of rchaves's "TWO co-existing workspace switchers"
 * bug-bash.
 *
 * Spec: specs/ai-gateway/governance/workspace-switcher.feature
 */
const ProjectScopeHeaderSwitcher = React.memo(function ProjectScopeHeaderSwitcher() {
  const data = useWorkspaceData();
  return <WorkspaceSwitcher {...data} />;
});

/**
 * Header chip rendered on org-scope routes (`/settings/*`, `/governance`).
 * These routes carry no project/team slug, so the resolved organization comes
 * from the `selectedOrganizationId` localStorage key. Renders the shared
 * `<WorkspaceSwitcher>` with the org as the current chip so the user can jump
 * straight back into any project or their personal workspace (the regression
 * that prompted this: the old static chip had no way back to a project).
 * Multi-org users additionally get an in-place org switch, which writes the
 * chosen org to the same `selectedOrganizationId` key the resolver reads
 * (usehooks-ts broadcasts a `local-storage` event so every reader re-resolves
 * in this tab) and navigates to `/settings`, the parent of every org-scoped
 * route, always valid for any org the user belongs to.
 */
const OrganizationScopeHeaderSwitcher = React.memo(
  function OrganizationScopeHeaderSwitcher() {
    const router = useRouter();
    const data = useWorkspaceData();
    const { organization, organizations } = useOrganizationTeamProject({
      redirectToOnboarding: false,
      redirectToProjectOnboarding: false,
    });
    const [, setSelectedOrganizationId] = useLocalStorage<string>(
      "selectedOrganizationId",
      "",
    );

    if (!organization) return null;

    const orgList = (organizations ?? []).map((org) => ({
      orgId: org.id,
      orgName: org.name,
      orgSlug: org.slug,
    }));

    const onSwitchOrganization = (orgId: string) => {
      if (orgId === organization.id) return;
      setSelectedOrganizationId(orgId);
      void router.push("/settings");
    };

    return (
      <WorkspaceSwitcher
        {...data}
        current={{
          kind: "organization",
          orgId: organization.id,
          orgName: organization.name,
        }}
        organizations={orgList}
        onSwitchOrganization={onSwitchOrganization}
      />
    );
  },
);

export const ProjectSelector = React.memo(function ProjectSelector({
  organizations,
  project,
}: {
  organizations: FullyLoadedOrganization[];
  project: Project;
}) {
  const router = useRouter();
  const { data: session } = useRequiredSession();
  const [open, setOpen] = useState(false);

  const sortByName = (a: { name: string }, b: { name: string }) =>
    a.name.toLowerCase() < b.name.toLowerCase()
      ? -1
      : a.name.toLowerCase() > b.name.toLowerCase()
        ? 1
        : 0;

  const projectGroups = organizations.sort(sortByName).flatMap((organization) =>
    organization.teams.flatMap((team) => ({
      organization,
      team,
      projects: team.projects.sort(sortByName),
    })),
  );

  return (
    <Menu.Root open={open} onOpenChange={({ open }) => setOpen(open)}>
      <Menu.Trigger asChild>
        <Button
          variant="ghost"
          fontSize="13px"
          paddingX={2}
          paddingY={1}
          height="auto"
          fontWeight="normal"
          minWidth="fit-content"
          color="fg"
          _hover={{
            backgroundColor: "bg.muted",
          }}
        >
          <HStack gap={2}>
            <ProjectAvatar name={project.name} />
            <Text>{project.name}</Text>
            <ChevronDown size={14} />
          </HStack>
        </Button>
      </Menu.Trigger>
      <Portal>
        <Box zIndex="popover" padding={0}>
          {open && (
            <Menu.Content>
              {projectGroups
                .filter((projectGroup) => {
                  // Org admins created via RoleBinding-only flow have no TeamUser row
                  // but still have full access. Resolve the current user's
                  // organization role explicitly rather than relying on
                  // members[0] being pre-filtered.
                  const currentUserOrgRole = projectGroup.organization.members.find(
                    (m) => m.userId === session?.user.id,
                  )?.role;
                  return (
                    currentUserOrgRole === OrganizationUserRole.ADMIN ||
                    (projectGroup.team.members?.some(
                      (member) => member.userId === session?.user.id,
                    ) ??
                      false)
                  );
                })
                .map((projectGroup) => (
                  <Menu.ItemGroup
                    key={projectGroup.team.id}
                    title={
                      projectGroup.organization.name +
                      (projectGroup.team.name !== projectGroup.organization.name
                        ? " - " + projectGroup.team.name
                        : "")
                    }
                  >
                    {projectGroup.projects.map((project_) => (
                      <Menu.Item
                        key={project_.id}
                        value={project_.id}
                        fontSize="14px"
                        asChild
                      >
                        <Link
                          key={project_.id}
                          href={buildProjectSwitchHref({
                            routePattern: router.pathname,
                            resolvedPathname: window.location.pathname,
                            currentProjectSlug: project.slug,
                            targetSlug: project_.slug,
                            homeFallback: "returnTo",
                          })}
                          onClick={() => {
                            const currentPath = window.location.pathname;
                            const hasProjectInPath = currentPath.includes(project.slug);
                            if (!hasProjectInPath) {
                              localStorage.setItem(
                                "selectedProjectSlug",
                                JSON.stringify(project_.slug),
                              );
                            }
                          }}
                          _hover={{
                            textDecoration: "none",
                          }}
                        >
                          <HStack gap={2}>
                            <ProjectAvatar name={project_.name} />
                            <Text>{project_.name}</Text>
                          </HStack>
                        </Link>
                      </Menu.Item>
                    ))}
                    <AddProjectButton
                      team={projectGroup.team}
                      organization={projectGroup.organization}
                    />
                  </Menu.ItemGroup>
                ))}
            </Menu.Content>
          )}
        </Box>
      </Portal>
    </Menu.Root>
  );
});

export const AddProjectButton = ({
  team,
  organization,
}: {
  team: Team;
  organization: Organization;
}) => {
  const { openDrawer } = useDrawer();

  return (
    <Menu.Item
      value={`new-project-${team.slug}`}
      fontSize="14px"
      onClick={() =>
        openDrawer("createProject", {
          navigateOnCreate: true,
          defaultTeamId: team.id,
          organizationId: organization.id,
        })
      }
    >
      <Plus />
      New Project
    </Menu.Item>
  );
};

export type DashboardLayoutProps = {
  publicPage?: boolean;
  compactMenu?: boolean;
  /**
   * Set on personal-scope routes (`/me`, `/me/configure`) where the page
   * intentionally has no project context. Disables the OTP hook's
   * "no project → bounce to /onboarding or /<defaultProjectSlug>"
   * redirect, which would otherwise hijack the route on first paint.
   */
  personalScope?: boolean;
  /**
   * Set on org-scope routes (`/governance`) where the page is scoped to
   * an organization, not a project. Same effect as `personalScope` on
   * project-redirect gating, but in the header replaces the
   * `<ProjectSelector>` with a flat org-name indicator (admins crossing
   * /governance ↔ /:project/* should never see the project picker on
   * the governance side, since governance is org-scoped, not
   * project-scoped - see governance-home-routing.feature).
   */
  orgScope?: boolean;
  /**
   * Override the default `LangWatch - {project.name}` tab title.
   * When set, the layout's <Head> emits this string verbatim.
   * Set on org-scope routes (governance overview, view-all listings,
   * detail pages) where the project-based default would otherwise read
   * "LangWatch - Personal Workspace" because the user has no active
   * project. Surfaced as Ariana QA finding G12 - child <Head> writers
   * lost the layout-effect race against the parent layout's <Head>,
   * so the only correct fix is to push the title down through props.
   */
  pageTitle?: string;
} & StackProps;

/**
 * Entry point for the dashboard chrome. Dispatches on the device's
 * navigation mode (specs/navigation/navigation-modes.feature): legacy
 * renders the current chrome synchronously, and a device on a v2 mode
 * shows the loading screen until the flag answers so the old chrome
 * never flashes. Public pages never consult the mode; they carry no
 * session to resolve a flag against.
 */
export const DashboardLayout = (dashboardProps: DashboardLayoutProps) => {
  if (dashboardProps.publicPage) {
    return <LegacyDashboardLayout {...dashboardProps} />;
  }
  return <ModeResolvedDashboardLayout {...dashboardProps} />;
};

const ModeResolvedDashboardLayout = (dashboardProps: DashboardLayoutProps) => {
  const resolution = useNavigationMode();
  const router = useRouter();
  if (resolution.status === "loading") return <LoadingScreen />;
  if (resolution.mode === "legacy") {
    return <LegacyDashboardLayout {...dashboardProps} />;
  }
  // The shells cover the product routes, the settings pages and the
  // internal ops pages. Everything else keeps the current chrome.
  if (!isNavigationV2ShellRoute(router.pathname)) {
    return <LegacyDashboardLayout {...dashboardProps} />;
  }
  return <NavigationV2Shell mode={resolution.mode} {...dashboardProps} />;
};

export const LegacyDashboardLayout = ({
  children,
  publicPage = false,
  compactMenu: compactMenuProp = false,
  personalScope = false,
  orgScope = false,
  pageTitle,
  ...props
}: DashboardLayoutProps) => {
  // fallback: "lg" tells Chakra to assume large screen during SSR/initial render,
  // so the menu starts expanded and only compacts after hydration on small screens.
  // This avoids the compact→expanded flicker on desktop page navigations.
  const isSmallScreen = useBreakpointValue({ base: true, lg: false }, { fallback: "lg" });
  const compactMenu = isSmallScreen ? true : compactMenuProp;
  const router = useRouter();

  // Apply a one-shot `?org=<slug>` selection on any org-scoped page, then strip
  // the param so the URL returns to its clean path. See
  // useOrgQueryParamSelection — this is what the switcher's per-org "My
  // Workspace" links and the in-place org switch target.
  useOrgQueryParamSelection();

  const { data: session } = useRequiredSession({ required: !publicPage });

  const bypassProjectGating = personalScope || orgScope;
  const { isLoading, organization, organizations, team, project, hasPermission } =
    useOrganizationTeamProject({
      redirectToOnboarding: !bypassProjectGating,
      redirectToProjectOnboarding: !bypassProjectGating,
    });
  const usage = api.limits.getUsage.useQuery(
    { organizationId: organization?.id ?? "" },
    {
      enabled: !!organization && hasPermission("organization:view"),
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    },
  );
  const publicEnv = usePublicEnv();

  usePostHogIdentify({
    session: session ?? null,
    organization,
    planType: usage.data?.activePlan?.type,
  });

  // Langy's docked panel joins this shell as a second content card. Claim the
  // dock while the shell is mounted so the page-level wrapper stands down
  // (LangyShiftedRoot), then reserve the panel's room inside the content row
  // only, the header keeps the full viewport width above both cards. The
  // reservation truth (`dockShifted`) is computed by the wrapper, which owns
  // Langy's visibility gate. Spec: specs/langy/langy-panel-layout.feature
  const langyDockShifted = useLangyStore((s) => s.dockShifted);
  const claimDockShell = useLangyStore((s) => s.claimDockShell);
  const releaseDockShell = useLangyStore((s) => s.releaseDockShell);
  useLayoutEffect(() => {
    claimDockShell();
    return releaseDockShell;
  }, [claimDockShell, releaseDockShell]);
  const langyDockInset = langyDockShifted ? LANGY_DOCKED_OFFSET + LANGY_DOCK_GAP : 0;

  if (typeof router.query.project === "string" && !isLoading && !project) {
    return <NotFoundScene />;
  }

  const isOpsRoute = router.pathname.startsWith("/ops");
  // Personal-project URLs (`/[personalProjectSlug]/*`) get the /me chrome
  // automatically - clicking from PersonalSidebar's Traces link into the
  // existing project-scoped explorer keeps the sidebar shape consistent
  // with the rest of /me/* instead of flipping to MainMenu. Detection:
  // current team is the caller's own Personal Workspace (Team.isPersonal
  // && Team.ownerUserId === me).
  const isOnOwnPersonalProject =
    !!team?.isPersonal && team.ownerUserId === session?.user?.id;
  const isPersonalScopeRoute =
    personalScope || router.pathname.startsWith("/me") || isOnOwnPersonalProject;
  const isOrgScopeRoute = orgScope || router.pathname === "/governance";

  if (
    !publicPage &&
    (!session ||
      isLoading ||
      // Persona-1 (org-less CLI/IDE devs) are a first-class persona on
      // /me - they legitimately have no organization. Don't trap them
      // in LoadingScreen on personal-scope routes. Other route classes
      // (project chrome, ops, governance/orgScope) still require an
      // organization context.
      (!isPersonalScopeRoute && (!organization || !organizations)) ||
      (!isOpsRoute &&
        !isPersonalScopeRoute &&
        !isOrgScopeRoute &&
        // ADR-038 v6: intent-set orgs can legitimately have no project
        // (governance by design; LLMOps until its first project is
        // created) — org-level chrome (e.g. /settings) must still render.
        !organization?.primaryIntent &&
        (!team || !project)))
  ) {
    return <LoadingScreen />;
  }

  const user = session?.user;
  const currentRoute = findCurrentRoute(router.pathname);

  const menuWidth = compactMenu ? MENU_WIDTH_COMPACT : MENU_WIDTH_EXPANDED;
  // The presence toggle is meaningful only on the traces v2 lens
  // (multiplayer cursors + section presence are wired there). Gate the
  // avatar-menu entry so it stays off the other surfaces' chrome.
  const showPresenceMenuItem = router.pathname.startsWith("/[project]/traces");

  return (
    <Box
      width="full"
      minHeight="100vh"
      background="bg.page"
      overflowX={["auto", "auto", "hidden"]}
    >
      <Head>
        <title>
          {pageTitle ?? (
            <>
              LangWatch{project ? ` - ${project.name}` : ""}
              {currentRoute && currentRoute.title !== "Home"
                ? ` - ${currentRoute?.title}`
                : ""}
            </>
          )}
        </title>
      </Head>

      {/* Offered once to somebody signed in without a passkey, then not for
          thirty days (ADR-120). Mounted in the shell rather than on a route
          because "after signing in" is wherever they landed; it decides for
          itself whether to render, and renders nothing on nearly every load. */}
      <PasskeyNudge />

      {/* Header bar - spans full width with gray background. Pinned to the
          shared APP_HEADER_HEIGHT: the viewport math below and the docked
          Langy card's top edge both derive from it, so the cards start exactly
          where the header ends. */}
      <HStack
        position="relative"
        width="full"
        height={`${APP_HEADER_HEIGHT}px`}
        paddingX={4}
        paddingY={3}
        background="bg.page"
        justifyContent="space-between"
        gap={4}
        overflow="hidden"
      >
        {(user?.impersonator || publicEnv.data?.NODE_ENV === "development") && (
          <Box
            position="absolute"
            top={-5}
            right="-100px"
            bottom={0}
            w="400px"
            background={user?.impersonator ? "blue.300" : "orange.300"}
            filter="blur(40px)"
            pointerEvents="none"
          ></Box>
        )}

        {/* Left side: Logo + Project + Breadcrumbs */}
        <HStack gap={compactMenu ? 3 : 0} flex={1} alignItems="center">
          {/* Logo container - fixed width for expanded menu, natural for compact */}
          {compactMenu ? (
            <Link href="/" display="flex" alignItems="center">
              <LogoIcon width={25 * 0.7} height={32 * 0.7} />
            </Link>
          ) : (
            <Box
              width={MENU_WIDTH_EXPANDED}
              minWidth={MENU_WIDTH_EXPANDED}
              paddingLeft={2}
              display="flex"
              alignItems="center"
            >
              <Link href="/">
                <FullLogo width={155 * 0.7} height={38 * 0.7} />
              </Link>
            </Box>
          )}
          {router.pathname.startsWith("/ops") ? (
            <HStack gap={3} alignItems="center" paddingLeft={2}>
              <HStack
                gap={1.5}
                paddingX={2.5}
                height="28px"
                borderRadius="md"
                bg="bg.emphasized"
              >
                <Activity size={14} />
                <Text fontSize="sm" fontWeight="medium">
                  Ops
                </Text>
              </HStack>
              <HStack
                gap={1.5}
                paddingX={2.5}
                height="28px"
                borderRadius="md"
                bg="orange.500/8"
                border="1px solid"
                borderColor="orange.500/15"
              >
                <Info size={12} color="var(--chakra-colors-orange-400)" />
                <Text fontSize="xs" color="orange.400">
                  Platform-wide - not scoped to a project
                </Text>
              </HStack>
            </HStack>
          ) : isOrgScopeRoute && organization ? (
            <HStack gap={0} alignItems="center" paddingLeft={2}>
              <OrganizationScopeHeaderSwitcher />
            </HStack>
          ) : isPersonalScopeRoute && organizations ? (
            <HStack gap={0} alignItems="center" paddingLeft={2}>
              <PersonalScopeHeaderSwitcher />
            </HStack>
          ) : organizations && project ? (
            <HStack gap={0} alignItems="center">
              <ProjectScopeHeaderSwitcher />
              <Box display={["none", "none", "flex"]}>
                <Breadcrumbs currentRoute={currentRoute} />
              </Box>
            </HStack>
          ) : organization ? (
            // Project-less org (governance intent, ADR-038 v6): org-scoped
            // switcher instead of falling through to the sign-in link.
            <HStack gap={0} alignItems="center" paddingLeft={2}>
              <OrganizationScopeHeaderSwitcher />
            </HStack>
          ) : (
            <Text paddingLeft={2}>
              <Link href="/auth/signin" color="orange.600" fontWeight="600">
                Sign in
              </Link>{" "}
              to LangWatch to monitor your projects
            </Text>
          )}
        </HStack>

        {/* Right side: Search, integrations, user */}
        <HStack gap={2} justifyContent="flex-end" overflow="hidden">
          {publicEnv.data?.NODE_ENV === "development" && <DevBadge />}
          {user && <ImpersonationBanner user={user} />}

          {/* Command bar trigger */}
          {project && <CommandBarTrigger />}

          <AppHeaderUserMenu
            publicPage={publicPage}
            showPresenceMenuItem={showPresenceMenuItem}
          />
        </HStack>
      </HStack>

      {/* Main content area with sidebar */}
      <HStack
        width="full"
        alignItems="stretch"
        gap={0}
        minHeight={`calc(100vh - ${APP_HEADER_HEIGHT}px)`}
      >
        {isPersonalScopeRoute ? (
          <PersonalSidebar isCompact={compactMenu} />
        ) : (
          <MainMenu isCompact={compactMenu} />
        )}

        <Box
          width="full"
          height="full"
          background="bg.page"
          minHeight={`calc(100vh - ${APP_HEADER_HEIGHT}px)`}
          maxHeight={`calc(100vh - ${APP_HEADER_HEIGHT}px)`}
          maxWidth={`calc(100vw - ${menuWidth})`}
          // While Langy is docked, this gray ground keeps the viewport edge and
          // the content card pulls in: the reserved strip is where the docked
          // panel sits as a second card, with a gap of page ground between the
          // two. Spec: specs/langy/langy-panel-layout.feature
          paddingRight={`${langyDockInset}px`}
          transition={`padding-right ${LANGY_TRANSITION}`}
        >
          <Box
            width="full"
            height="full"
            background="bg.surface"
            borderTopLeftRadius="xl"
            // The Langy panel's edge, on the card that holds the whole app —
            // one notch quieter than the panel's own: the muted hairline on
            // the two edges that meet the page chrome, and (dark) a fainter
            // cut of the panel's inset lit top rim, so the surface reads as
            // a raised card catching light rather than a flat cut-out.
            borderTopWidth="1px"
            borderLeftWidth="1px"
            borderStyle="solid"
            borderColor="border.muted"
            // With Langy docked the card no longer meets the viewport edge, so
            // its right side joins the page-chrome language too: the same
            // radius and muted hairline as its top-left corner.
            borderTopRightRadius={langyDockInset > 0 ? "xl" : 0}
            borderRightWidth={langyDockInset > 0 ? "1px" : 0}
            _dark={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.07)" }}
            overflow="auto"
            display="flex"
            minHeight={`calc(100vh - ${APP_HEADER_HEIGHT}px)`}
            maxHeight={`calc(100vh - ${APP_HEADER_HEIGHT}px)`}
            position="relative"
          >
            <DashboardPageBody
              publicPage={publicPage}
              personalScope={personalScope}
              {...props}
            >
              {children}
            </DashboardPageBody>
          </Box>
        </Box>
      </HStack>
      {/* No MissingModelModal mount - the global tRPC / QueryCache
          interceptors emit a sticky orange toast via
          `showMissingModelToast` (deduped per (featureKey, role)).
          Toast lives in the toaster portal that's already at the app
          root; nothing else to mount here. See
          specs/model-providers/missing-model-popup.feature. */}
    </Box>
  );
};
