import {
  Alert,
  Box,
  Button,
  HStack,
  Spacer,
  type StackProps,
  Text,
  VStack,
} from "@chakra-ui/react";
import { KeyRound } from "lucide-react";
import numeral from "numeral";
import { useEffect } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { OrganizationUserRole } from "~/generated/prisma/client";
import { useRouter } from "~/utils/compat/next-router";
import { GlobalTraceV2DrawerMount } from "../features/traces-v2/components/GlobalTraceV2DrawerMount";
import {
  useOrganizationTeamProject,
  userBelongsToTeam,
} from "../hooks/useOrganizationTeamProject";
import { usePlanManagementUrl } from "../hooks/usePlanManagementUrl";
import { usePublicEnv } from "../hooks/usePublicEnv";
import { useRequiredSession } from "../hooks/useRequiredSession";
import { SavedViewsProvider } from "../hooks/useSavedViews";
import { api } from "../utils/api";
import { trackEvent } from "../utils/tracking";
import { AnnouncementBanner } from "./AnnouncementBanner";
import { CurrentDrawer } from "./CurrentDrawer";
import { AdminViewingAsBanner } from "./governance/AdminViewingAsBanner";
import { SavedViewsBar } from "./SavedViewsBar";
import { GlobalUpgradeModal } from "./UpgradeModal";
import { Link } from "./ui/link";
import { PageErrorFallback } from "./ui/PageErrorFallback";

export type DashboardPageBodyProps = {
  publicPage?: boolean;
  /** Personal-scope routes count the viewer as on their own team. */
  personalScope?: boolean;
} & StackProps;

/**
 * The interior of the dashboard content card: alert banners, the
 * admin-viewing-as chrome, the global drawers, the team-membership guard
 * and the page body itself. Every shell (legacy chrome and the
 * navigation-v2 ones) renders this same component inside its own frame,
 * so the page-level behavior cannot drift between shells. Self-hooked:
 * it resolves its own session, org context and queries.
 */
export const DashboardPageBody = ({
  children,
  publicPage = false,
  personalScope = false,
  ...props
}: DashboardPageBodyProps) => {
  const router = useRouter();
  const { data: session } = useRequiredSession({ required: !publicPage });
  const { organization, team, project, organizationRole, hasPermission } =
    useOrganizationTeamProject({
      redirectToOnboarding: false,
      redirectToProjectOnboarding: false,
    });
  const publicEnv = usePublicEnv();
  const { url: planManagementUrl } = usePlanManagementUrl();
  const usage = api.limits.getUsage.useQuery(
    { organizationId: organization?.id ?? "" },
    {
      enabled: !!organization && hasPermission("organization:view"),
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    },
  );
  const { data: ssoStatus } = api.user.getSsoStatus.useQuery({}, { enabled: !!session });

  const user = session?.user;
  const isOnOwnPersonalProject =
    !!team?.isPersonal && team.ownerUserId === session?.user?.id;
  // Admin viewing-as detection: org-admin is on a project that belongs
  // to ANOTHER user's Personal Workspace. Drives the persistent
  // <AdminViewingAsBanner> chrome - the only legitimate "you're using
  // admin bypass to view someone else's data" case. ORG:ADMIN cascades
  // to every team in the org as implicit membership, so a team-kind
  // banner would shout "viewing as admin" on the admin's own dashboards.
  // Team drill-throughs are silent.
  //
  // Gated to URL-anchored project routes ONLY - admin-self surfaces
  // (/governance, /settings/*, /me/*, /ops/*) MUST NOT fire the banner
  // even when `team` is sticky-resolved from a previously-visited project
  // context, otherwise the admin sees "Viewing X's workspace" plastered on
  // their own governance dashboard.
  const isProjectAnchoredRoute = router.pathname.startsWith("/[project]");
  const adminViewingAs: { label: string } | null =
    isProjectAnchoredRoute &&
    organizationRole === OrganizationUserRole.ADMIN &&
    team?.isPersonal &&
    team.ownerUserId !== session?.user?.id
      ? { label: team.name }
      : null;
  const isPersonalScopeRoute =
    personalScope || router.pathname.startsWith("/me") || isOnOwnPersonalProject;

  // Audit/OCSF emission for cross-scope reads. Fires once per project
  // navigation when admin's drilled into another user/team's workspace -
  // recordWorkspaceView writes the AuditLog row + OCSF event
  // synchronously. Fail-quiet: emission errors don't block render.
  const recordWorkspaceViewMutation = api.governance.recordWorkspaceView.useMutation();
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

  // Requires BOTH sides present: an install with no demo project configured
  // leaves DEMO_PROJECT_SLUG undefined, and `===` against an equally-undefined
  // `project?.slug` would otherwise read as a match on any route that hasn't
  // resolved a project yet.
  const isDemoProject =
    !!publicEnv.data?.DEMO_PROJECT_SLUG &&
    publicEnv.data.DEMO_PROJECT_SLUG === project?.slug;
  const userIsPartOfTeam =
    publicPage ||
    // Personal-scope routes (/me/* and the caller's own Personal Workspace
    // project URLs) are theirs by construction - the user is always "on
    // their own team" in this scope, even when team membership of the
    // ambient org-default team can't be confirmed. Without this clause,
    // MEMBER users on /me/* hit "You are not part of any team" overlay
    // and the page body never renders.
    isPersonalScopeRoute ||
    isDemoProject ||
    // Same predicate the ambient team resolution prefers on, so the team the
    // app picks and the team the chrome will render for cannot diverge.
    (!!team && !!user?.id && userBelongsToTeam(team, user.id)) ||
    // Org admins created via RoleBinding-only flow have no TeamUser row but still
    // have full team access - mirrors server-side org-scoped ADMIN RoleBinding logic.
    organizationRole === OrganizationUserRole.ADMIN;

  // Analytics is the last surface on the v1 saved-views bar; the Trace
  // Explorer carries its own view system.
  const showSavedViews = router.pathname.startsWith("/[project]/analytics");

  return (
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
                Please check your environment variables, the following variables are not
                set which are required for evaluations and workflows:
              </Text>
              {!publicEnv.data?.HAS_LANGWATCH_NLP_SERVICE && (
                <Text>LANGWATCH_NLP_SERVICE</Text>
              )}
              {!publicEnv.data?.HAS_LANGEVALS_ENDPOINT && <Text>LANGEVALS_ENDPOINT</Text>}
            </Alert.Content>
          </Alert.Root>
        )}
      {usage.data?.messageLimitInfo && usage.data.messageLimitInfo.status !== "ok" && (
        <Alert.Root
          status={usage.data.messageLimitInfo.status === "exceeded" ? "error" : "warning"}
          width="full"
          borderBottom="1px solid"
          borderBottomColor={
            usage.data.messageLimitInfo.status === "exceeded" ? "red.300" : "yellow.300"
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
                      usage.data?.messageLimitInfo.status === "exceeded"
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
      {usage.data && usage.data.currentMonthCost > usage.data.maxMonthlyUsageLimit && (
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
              {numeral(usage.data.maxMonthlyUsageLimit).format("$0.00")} usage cost for
              this month, evaluations and guardrails will not be processed.{" "}
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

      {adminViewingAs && <AdminViewingAsBanner workspaceLabel={adminViewingAs.label} />}

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
                  Your organization requires SSO login. Please link your account by
                  logging in via the email input box on the sign-in page.
                </Text>
              </VStack>
              <Button size="sm" colorPalette="red" flexShrink={0} color="white" asChild>
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
        <Box flex="1" minHeight={0} width="full" display="flex" flexDirection="column">
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
                You are not part of any team in this organization. Ask your administrator
                to add you, or{" "}
                <Link href="/" textDecoration="underline">
                  go back to your home page
                </Link>
                .
              </Text>
            </HStack>
          </Alert.Content>
        </Alert.Root>
      )}
      <GlobalUpgradeModal />
    </VStack>
  );
};
