import {
  Alert,
  Avatar,
  Box,
  Button,
  HStack,
  Portal,
  Spacer,
  type StackProps,
  Text,
  useBreakpointValue,
  VStack,
} from "@chakra-ui/react";
import {
  type Organization,
  OrganizationUserRole,
  type Project,
  type Team,
} from "@prisma/client";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  Info,
  KeyRound,
  Plus,
} from "lucide-react";
import numeral from "numeral";
import React, { useEffect, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { useLocalStorage } from "usehooks-ts";
import { NotFoundScene } from "~/components/NotFoundScene";
import Head from "~/utils/compat/next-head";
import { isLangwatchStaff } from "~/utils/isLangwatchStaff";
import { useRouter } from "~/utils/compat/next-router";
import { ImpersonationBanner } from "../../ee/admin/ImpersonationBanner";
import { ImpersonationSwitchBackMenuItem } from "../../ee/admin/ImpersonationSwitchBackMenuItem";
import { CommandBarTrigger } from "../features/command-bar";
import { GlobalTraceV2DrawerMount } from "../features/traces-v2/components/GlobalTraceV2DrawerMount";
import { useDrawer } from "../hooks/useDrawer";
import { useFeatureFlag } from "../hooks/useFeatureFlag";
import { useLiteMemberGuard } from "../hooks/useLiteMemberGuard";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { useOrgQueryParamSelection } from "../hooks/useOrgQueryParamSelection";
import { usePlanManagementUrl } from "../hooks/usePlanManagementUrl";
import { usePostHogIdentify } from "../hooks/usePostHogIdentify";
import { usePublicEnv } from "../hooks/usePublicEnv";
import { useRequiredSession } from "../hooks/useRequiredSession";
import { SavedViewsProvider } from "../hooks/useSavedViews";
import type { FullyLoadedOrganization } from "../server/app-layer/organizations/repositories/organization.repository";
import { api } from "../utils/api";
import {
  buildProjectSwitchHref,
  findCurrentRoute,
  projectRoutes,
  type Route,
} from "../utils/routes";
import { trackEvent } from "../utils/tracking";
import { AnnouncementBanner } from "./AnnouncementBanner";
import { CurrentDrawer } from "./CurrentDrawer";
import { AdminViewingAsBanner } from "./governance/AdminViewingAsBanner";
import { LangyProvider, useLangy } from "./langy/LangyContext";
import {
  LangyDrawer,
  LANGY_DOCKED_OFFSET,
  LANGY_TRANSITION,
} from "./langy/LangySidebar";
import { FullLogo } from "./icons/FullLogo";
import { LogoIcon } from "./icons/LogoIcon";
import { LoadingScreen } from "./LoadingScreen";
import { MainMenu, MENU_WIDTH_COMPACT, MENU_WIDTH_EXPANDED } from "./MainMenu";
import { SavedViewsBar } from "./messages/SavedViewsBar";
import { PersonalSidebar } from "./PersonalSidebar";
import { ProjectAvatar } from "./ProjectAvatar";
import { SdkRadarBanner } from "./SdkRadarBanner";
import { PresenceMenuItem } from "./sidebar/PresenceMenuItem";
import { GlobalUpgradeModal } from "./UpgradeModal";
import { Link } from "./ui/link";
import { Menu } from "./ui/menu";
import { PageErrorFallback } from "./ui/PageErrorFallback";
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
const PersonalScopeHeaderSwitcher = React.memo(
  function PersonalScopeHeaderSwitcher() {
    const data = useWorkspaceData();
    return <WorkspaceSwitcher {...data} current={{ kind: "personal" }} />;
  },
);

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
const ProjectScopeHeaderSwitcher = React.memo(
  function ProjectScopeHeaderSwitcher() {
    const data = useWorkspaceData();
    return <WorkspaceSwitcher {...data} />;
  },
);

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
                  const currentUserOrgRole =
                    projectGroup.organization.members.find(
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
                            const hasProjectInPath = currentPath.includes(
                              project.slug,
                            );
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

export const DashboardLayout = ({
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
  const isSmallScreen = useBreakpointValue(
    { base: true, lg: false },
    { fallback: "lg" },
  );
  const compactMenu = isSmallScreen ? true : compactMenuProp;
  const router = useRouter();

  // Apply a one-shot `?org=<slug>` selection on any org-scoped page, then strip
  // the param so the URL returns to its clean path. See
  // useOrgQueryParamSelection — this is what the switcher's per-org "My
  // Workspace" links and the in-place org switch target.
  useOrgQueryParamSelection();

  const { data: session } = useRequiredSession({ required: !publicPage });

  const bypassProjectGating = personalScope || orgScope;
  const {
    isLoading,
    organization,
    organizations,
    team,
    project,
    organizationRole,
    hasPermission,
  } = useOrganizationTeamProject({
    redirectToOnboarding: !bypassProjectGating,
    redirectToProjectOnboarding: !bypassProjectGating,
  });
  const { isLiteMember } = useLiteMemberGuard();
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
  const { url: planManagementUrl } = usePlanManagementUrl();
  const { data: ssoStatus } = api.user.getSsoStatus.useQuery(
    {},
    { enabled: !!session },
  );
  // The "My Workspace" entry in the user-avatar dropdown is part of the
  // governance preview surface, distinct from the existing AI Gateway
  // menu (which keeps shipping unblocked under release_ui_ai_gateway_menu_enabled).
  // The flag is org-targeted, so it must resolve on the org id - gating on
  // project would diverge from the /me pages (which key off the org) and
  // show the menu entry while the page it links to 404s.
  const { enabled: governancePreviewEnabled } = useFeatureFlag(
    "release_ui_ai_governance_enabled",
    { organizationId: organization?.id, enabled: !!organization?.id },
  );

  usePostHogIdentify({
    session: session ?? null,
    organization,
    planType: usage.data?.activePlan?.type,
  });

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
  // Admin viewing-as detection: org-admin is on a project that belongs
  // to ANOTHER user's Personal Workspace. Drives the persistent
  // <AdminViewingAsBanner> chrome - the only legitimate "you're using
  // admin bypass to view someone else's data" case. ORG:ADMIN cascades
  // to every team in the org as implicit membership, so a team-kind
  // banner would shout "viewing as admin" on the admin's own dashboards
  // (rchaves bug 19: solo and small-org admins kept seeing it on teams
  // they de-facto own). Team drill-throughs are silent.
  //
  // Gated to URL-anchored project routes ONLY - admin-self surfaces
  // (/governance, /settings/*, /me/*, /ops/*) MUST NOT fire the banner
  // even when `team` is sticky-resolved from a previously-visited project
  // context, otherwise the admin sees "Viewing X's workspace" plastered on
  // their own governance dashboard. The URL-anchor check uses the
  // `[project]` slug pattern: only `/[project]/*` routes are real
  // project-scoped views where the impersonation chrome makes sense.
  const isProjectAnchoredRoute = router.pathname.startsWith("/[project]");
  const adminViewingAs: { label: string } | null =
    isProjectAnchoredRoute &&
    organizationRole === OrganizationUserRole.ADMIN &&
    team?.isPersonal &&
    team.ownerUserId !== session?.user?.id
      ? { label: team.name }
      : null;
  const isPersonalScopeRoute =
    personalScope ||
    router.pathname.startsWith("/me") ||
    isOnOwnPersonalProject;
  const isOrgScopeRoute = orgScope || router.pathname === "/governance";

  // Audit/OCSF emission for cross-scope reads. Fires once per project
  // navigation when admin's drilled into another user/team's workspace -
  // sergey's recordWorkspaceView writes the AuditLog row + OCSF event
  // synchronously. Fail-quiet: emission errors don't block render.
  const recordWorkspaceViewMutation =
    api.governance.recordWorkspaceView.useMutation();
  const targetTeamId = adminViewingAs ? team?.id : undefined;
  useEffect(() => {
    if (
      adminViewingAs &&
      targetTeamId &&
      organization?.id &&
      !recordWorkspaceViewMutation.isPending
    ) {
      recordWorkspaceViewMutation.mutate({
        organizationId: organization.id,
        targetTeamId,
        kind: "personal",
        workspaceLabel: adminViewingAs.label,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetTeamId, organization?.id, adminViewingAs?.label]);

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
        (!team || !project)))
  ) {
    return <LoadingScreen />;
  }

  const user = session?.user;
  const currentRoute = findCurrentRoute(router.pathname);
  const isDemoProject = publicEnv.data?.DEMO_PROJECT_SLUG === project?.slug;
  const userIsPartOfTeam =
    publicPage ||
    // Personal-scope routes (/me/* and the caller's own Personal Workspace
    // project URLs) are theirs by construction - the user is always "on
    // their own team" in this scope, even when team membership of the
    // ambient org-default team can't be confirmed (e.g. team isn't resolved
    // for /me/*, or the privacy filter redacts member rows below the field
    // the predicate inspects). Without this clause, MEMBER users on /me/*
    // hit "You are not part of any team" overlay and the page body never
    // renders. Affects every persona-1 entry point + the v2 chrome-retention
    // path on personal-project URLs.
    isPersonalScopeRoute ||
    isDemoProject ||
    (team?.members?.some((member) => member.userId === user?.id) ?? false) ||
    // Org admins created via RoleBinding-only flow have no TeamUser row but still
    // have full team access - mirrors server-side org-scoped ADMIN RoleBinding logic.
    organizationRole === OrganizationUserRole.ADMIN;

  const menuWidth = compactMenu ? MENU_WIDTH_COMPACT : MENU_WIDTH_EXPANDED;
  const isTracesOrAnalyticsPage =
    router.pathname.startsWith("/[project]/messages") ||
    router.pathname.startsWith("/[project]/analytics");
  const showSavedViews = isTracesOrAnalyticsPage;
  // The presence toggle is meaningful only on the traces v2 lens
  // (multiplayer cursors + section presence are wired there). Gate the
  // avatar-menu entry so it stays off the other surfaces' chrome.
  const showPresenceMenuItem = router.pathname.startsWith("/[project]/traces");

  const isProjectRoute =
    router.pathname === "/[project]" ||
    router.pathname.startsWith("/[project]/");
  const { enabled: langyFlagEnabled } = useFeatureFlag(
    "release_langy_enabled",
    {
      projectId: project?.id,
      organizationId: organization?.id,
      enabled: !!project,
    },
  );
  const showLangy =
    !publicPage &&
    userIsPartOfTeam &&
    isProjectRoute &&
    isLangwatchStaff(user?.email) &&
    langyFlagEnabled;

  return (
    <LangyProvider>
      <LangyShiftedRoot showLangy={showLangy}>
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

      {/* Header bar - spans full width with gray background */}
      <HStack
        position="relative"
        width="full"
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
          {publicEnv.data?.NODE_ENV === "development" && (
            <Text
              fontSize="11px"
              fontWeight="bold"
              color="white"
              backgroundColor="blackAlpha.600"
              border="1px solid"
              borderColor="whiteAlpha.300"
              borderRadius="full"
              height="32px"
              paddingX={3}
              display="flex"
              alignItems="center"
              letterSpacing="wider"
            >
              DEV
            </Text>
          )}
          {user && <ImpersonationBanner user={user} />}

          {/* Command bar trigger */}
          {project && <CommandBarTrigger />}

          <Menu.Root>
            <Menu.Trigger asChild>
              <Button
                variant="ghost"
                size="xs"
                padding={0}
                minWidth="auto"
                height="auto"
                borderRadius="full"
                {...(publicPage
                  ? {
                      // On a public share page, clicking the avatar offers
                      // sign-in. Route to the signin page with the current
                      // URL as callbackUrl so the UI picks the right provider
                      // from `publicEnv.NEXTAUTH_PROVIDER`. The old version
                      // hardcoded `signIn("auth0")` which broke for on-prem
                      // (email mode), google, gitlab, etc.
                      onClick: () => {
                        if (typeof window !== "undefined") {
                          const callbackUrl = encodeURIComponent(
                            window.location.pathname + window.location.search,
                          );
                          window.location.href = `/auth/signin?callbackUrl=${callbackUrl}`;
                        }
                      },
                    }
                  : {})}
              >
                <Avatar.Root
                  size="xs"
                  backgroundColor="orange.400"
                  color="white"
                  width="28px"
                  height="28px"
                >
                  <Avatar.Fallback
                    name={user?.name ?? undefined}
                    fontSize="11px"
                  />
                </Avatar.Root>
              </Button>
            </Menu.Trigger>
            {session && (
              <Portal>
                <Menu.Content>
                  <ImpersonationSwitchBackMenuItem />
                  <Menu.ItemGroup
                    title={`${session.user.name} (${session.user.email})`}
                  >
                    {governancePreviewEnabled && (
                      <Menu.Item value="my-workspace" asChild>
                        <Link href="/me">My Workspace</Link>
                      </Menu.Item>
                    )}
                    {!isLiteMember && (
                      <Menu.Item value="api-keys" asChild>
                        <Link href="/settings/api-keys">API Keys</Link>
                      </Menu.Item>
                    )}
                    <Menu.Item value="settings" asChild>
                      <Link href="/settings">Settings</Link>
                    </Menu.Item>
                    {showPresenceMenuItem && <PresenceMenuItem />}
                    <Menu.Item value="logout" asChild>
                      <a href="/api/auth/logout">Logout</a>
                    </Menu.Item>
                  </Menu.ItemGroup>
                </Menu.Content>
              </Portal>
            )}
          </Menu.Root>
        </HStack>
      </HStack>

      {/* Main content area with sidebar */}
      <HStack
        width="full"
        alignItems="stretch"
        gap={0}
        minHeight="calc(100vh - 56px)"
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
          minHeight="calc(100vh - 56px)"
          maxHeight="calc(100vh - 56px)"
          maxWidth={`calc(100vw - ${menuWidth})`}
        >
          <Box
            width="full"
            height="full"
            background="bg.surface"
            borderTopLeftRadius="xl"
            overflow="auto"
            display="flex"
            minHeight="calc(100vh - 56px)"
            maxHeight="calc(100vh - 56px)"
            position="relative"
          >
            <VStack width="full" gap={0} {...props}>
              {/* Alert banners */}
              {publicEnv.data &&
                (!publicEnv.data?.HAS_LANGWATCH_NLP_SERVICE ||
                  !publicEnv.data?.HAS_LANGEVALS_ENDPOINT) && (
                  <Alert.Root
                    status="warning"
                    width="full"
                    borderBottom="1px solid"
                    borderBottomColor="yellow.300"
                    borderTopLeftRadius="2xl"
                  >
                    <Alert.Indicator />
                    <Alert.Content>
                      <Text>
                        Please check your environment variables, the following
                        variables are not set which are required for evaluations
                        and workflows:
                      </Text>
                      {!publicEnv.data?.HAS_LANGWATCH_NLP_SERVICE && (
                        <Text>LANGWATCH_NLP_SERVICE</Text>
                      )}
                      {!publicEnv.data?.HAS_LANGEVALS_ENDPOINT && (
                        <Text>LANGEVALS_ENDPOINT</Text>
                      )}
                    </Alert.Content>
                  </Alert.Root>
                )}
              {usage.data?.messageLimitInfo &&
                usage.data.messageLimitInfo.status !== "ok" && (
                  <Alert.Root
                    status={
                      usage.data.messageLimitInfo.status === "exceeded"
                        ? "error"
                        : "warning"
                    }
                    width="full"
                    borderBottom="1px solid"
                    borderBottomColor={
                      usage.data.messageLimitInfo.status === "exceeded"
                        ? "red.300"
                        : "yellow.300"
                    }
                  >
                    <Alert.Indicator />
                    <Alert.Content>
                      <Text>
                        {usage.data.messageLimitInfo.message}{" "}
                        <Link
                          href={planManagementUrl}
                          textDecoration="underline"
                          _hover={{
                            textDecoration: "none",
                          }}
                          onClick={() => {
                            trackEvent("subscription_hook_click", {
                              project_id: project?.id,
                              hook:
                                usage.data?.messageLimitInfo.status ===
                                "exceeded"
                                  ? "messages_limit_reached"
                                  : "messages_limit_warning",
                            });
                          }}
                        >
                          Click here
                        </Link>{" "}
                        to upgrade your plan.
                      </Text>
                    </Alert.Content>
                  </Alert.Root>
                )}
              {usage.data &&
                usage.data.currentMonthCost >
                  usage.data.maxMonthlyUsageLimit && (
                  <Alert.Root
                    status="warning"
                    width="full"
                    borderBottom="1px solid"
                    borderBottomColor="yellow.300"
                  >
                    <Alert.Indicator />
                    <Alert.Content>
                      <Text>
                        You reached the limit of{" "}
                        {numeral(usage.data.maxMonthlyUsageLimit).format(
                          "$0.00",
                        )}{" "}
                        usage cost for this month, evaluations and guardrails
                        will not be processed.{" "}
                        <Link
                          href="/settings/usage"
                          textDecoration="underline"
                          _hover={{
                            textDecoration: "none",
                          }}
                          onClick={() => {
                            trackEvent("subscription_hook_click", {
                              project_id: project?.id,
                              hook: "usage_cost_limit_reached",
                            });
                          }}
                        >
                          Go to settings
                        </Link>{" "}
                        to check your usage spending limit or upgrade your plan.
                      </Text>
                    </Alert.Content>
                  </Alert.Root>
                )}

              <AnnouncementBanner />
              <SdkRadarBanner />

              {adminViewingAs && (
                <AdminViewingAsBanner workspaceLabel={adminViewingAs.label} />
              )}

              {ssoStatus?.pendingSsoSetup && (
                <Alert.Root
                  status="error"
                  width="full"
                  border="1px solid"
                  borderColor="colorPalette.muted"
                  marginX={4}
                  marginTop={3}
                  borderRadius="lg"
                  maxWidth="calc(100% - 22px)"
                >
                  <Alert.Indicator />
                  <Alert.Content>
                    <HStack width="full" gap={4}>
                      <VStack align="start" gap={0} flex={1}>
                        <Alert.Title fontWeight="bold">
                          Action Required: Link your SSO account
                        </Alert.Title>
                        <Text fontSize="sm">
                          Your organization requires SSO login. Please link your
                          account by logging in via the email input box on the
                          sign-in page.
                        </Text>
                      </VStack>
                      <Button
                        size="sm"
                        colorPalette="red"
                        flexShrink={0}
                        color="white"
                        asChild
                      >
                        <Link href="/settings/authentication">
                          <KeyRound size={14} />
                          Link SSO Account
                        </Link>
                      </Button>
                    </HStack>
                  </Alert.Content>
                </Alert.Root>
              )}

              {publicEnv.data?.DEMO_PROJECT_SLUG &&
                publicEnv.data.DEMO_PROJECT_SLUG === router.query.project && (
                  <HStack width="full" backgroundColor="orange.400" padding={1}>
                    <Spacer />
                    <Text fontSize="sm">
                      Viewing Demo Project - Go back to yours{" "}
                      <Link href="/" textDecoration="underline">
                        here
                      </Link>
                    </Text>
                    <Spacer />
                  </HStack>
                )}

              <CurrentDrawer />
              {/* v2 trace drawer is mounted globally so cross-page opens
                (e.g. clicking "Try the new one" from a /simulations
                drawer) actually render the shell. Self-skips on
                /[project]/traces where TracesPage already mounts it. */}
              <GlobalTraceV2DrawerMount />

              {userIsPartOfTeam ? (
                // Page body absorbs leftover vertical space inside the
                // scrollable VStack. Without `flex: 1` + `minHeight: 0`,
                // pages that use `height="full"` interpret it as "100%
                // of the VStack" - which includes banner height - so
                // showing a banner pushed the bottom of the page off
                // the viewport. Wrapping the body in a flex-1 box makes
                // banners take their natural height above and leaves
                // the page with `containerHeight − bannerStackHeight`,
                // which is what `height="full"` should mean. Banners
                // already render with their intrinsic heights because
                // VStack defaults to `align-items: stretch` and Alert
                // boxes don't shrink below content.
                <Box
                  flex="1"
                  minHeight={0}
                  width="full"
                  display="flex"
                  flexDirection="column"
                >
                  <ErrorBoundary
                    FallbackComponent={PageErrorFallback}
                    resetKeys={[router.pathname]}
                  >
                    {showSavedViews ? (
                      <SavedViewsProvider>
                        {children}
                        {/* Spacer to prevent fixed bottom bar from covering content */}
                        <Box height="64px" flexShrink={0} />
                        <SavedViewsBar />
                      </SavedViewsProvider>
                    ) : (
                      children
                    )}
                  </ErrorBoundary>
                </Box>
              ) : (
                <Alert.Root
                  status="warning"
                  width="full"
                  border="1px solid"
                  borderColor="colorPalette.muted"
                  marginX={4}
                  marginTop={3}
                  borderRadius="lg"
                  maxWidth="calc(100% - 22px)"
                >
                  <Alert.Indicator />
                  <Alert.Content>
                    <HStack width="full" gap={4}>
                      <Text flex={1}>
                        You are not part of any team in this organization. Ask
                        your administrator to add you, or{" "}
                        <Link href="/" textDecoration="underline">
                          go back to your home page
                        </Link>
                        .
                      </Text>
                    </HStack>
                  </Alert.Content>
                </Alert.Root>
              )}
            </VStack>
          </Box>
        </Box>
      </HStack>
      <GlobalUpgradeModal />
      {/* No MissingModelModal mount - the global tRPC / QueryCache
          interceptors emit a sticky orange toast via
          `showMissingModelToast` (deduped per (featureKey, role)).
          Toast lives in the toaster portal that's already at the app
          root; nothing else to mount here. See
          specs/model-providers/missing-model-popup.feature. */}
    </LangyShiftedRoot>
    </LangyProvider>
  );
};

function LangyShiftedRoot({
  showLangy,
  children,
}: {
  showLangy: boolean;
  children: React.ReactNode;
}) {
  const { isOpen } = useLangy();
  const shifted = showLangy && isOpen;
  return (
    <>
      <Box
        width="full"
        minHeight="100vh"
        background="bg.page"
        overflowX={["auto", "auto", "hidden"]}
        paddingRight={shifted ? `${LANGY_DOCKED_OFFSET}px` : 0}
        transition={`padding-right ${LANGY_TRANSITION}`}
      >
        {children}
      </Box>
      {showLangy && <LangyDrawerConnected />}
    </>
  );
}

function LangyDrawerConnected() {
  const { isOpen, setIsOpen, proposalHandlers, experimentSlug } = useLangy();
  return (
    <LangyDrawer
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      proposalHandlers={proposalHandlers}
      experimentSlug={experimentSlug}
    />
  );
}

function GlobalUpgradeModal() {
  const { isOpen, variant, close } = useUpgradeModalStore();
  if (!variant) return null;
  return <UpgradeModal open={isOpen} onClose={close} variant={variant} />;
}
