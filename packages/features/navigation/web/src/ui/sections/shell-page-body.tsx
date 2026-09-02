/**
 * The interior of the shell's content card: the banners, the cross-scope
 * chrome, the team-membership guard and the page itself.
 *
 * Moved from `platform/app/src/components/DashboardPageBody.tsx`. Every shell
 * renders this same component inside its own frame, so the page-level behavior
 * cannot drift between them.
 *
 * WHAT DID NOT TRAVEL, and why each is a deletion rather than a gap:
 *
 * - `CurrentDrawer` and `GlobalTraceV2DrawerMount`. The drawer mount moved to
 *   `@langwatch/ui-drawer` and the application's chrome route mounts it ONCE,
 *   above the outlet — which is where a drawer opened from any page can
 *   render. A second mount inside the page body would open every drawer twice.
 * - `AnnouncementBanner` and `GlobalUpgradeModal`. Both are the application's
 *   own marketing chrome rather than navigation's, and neither has a reader on
 *   this side.
 * - `SavedViewsProvider` / `SavedViewsBar`. `platform/app`'s `useSavedViews`
 *   no longer exists; the bar was the last surface of the v1 view system, and
 *   the Trace Explorer carries its own.
 * - `usePostHogIdentify` and `trackEvent`. Product analytics is the
 *   application's, the line every family since the gateway has drawn.
 * - `usePlanManagementUrl`. Three lines of `isSaaS ? … : …`, which is
 *   `planManagementHref` below rather than a port method for a branch the
 *   deployment reading already decides.
 */

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
import { useEffect } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { navigationApi } from "../../behavior/navigation-api";
import { useNavigationHost } from "../../model/navigation-host";
import { planManagementHref } from "../../model/plan-management-href";
import { AdminViewingAsBanner } from "../blocks/admin-viewing-as-banner";
import { NavigationLink } from "../elements/navigation-link";
import { PageErrorFallback } from "../elements/page-error-fallback";

export type ShellPageBodyProps = {
  /** Personal-scope routes count the viewer as on their own team. */
  personalScope?: boolean;
} & StackProps;

/**
 * Where a reader goes to change what they are paying for, re-published from
 * `model` so this banner and the command bar's "View Plans" entry resolve the
 * one address.
 */
export { planManagementHref };

/**
 * The organization role that carries administrative reach across every team.
 *
 * The wire's own spelling: the enum it came from is Prisma's, which a governed
 * web package may not import.
 */
const ORGANIZATION_ADMIN_ROLE = "ADMIN";

export const ShellPageBody = ({
  children,
  personalScope = false,
  ...props
}: ShellPageBodyProps) => {
  const host = useNavigationHost();
  const pathname = host.pathname();
  const user = host.currentUser();
  const organization = host.organization();
  const team = host.team();
  const project = host.project();
  const organizationRole = host.organizationRole();
  const deployment = host.deployment();

  const usage = navigationApi.limits.getUsage.useQuery(
    { organizationId: organization?.id ?? "" },
    {
      enabled: !!organization && host.hasPermission("organization:view"),
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    },
  );
  const { data: ssoStatus } = navigationApi.user.getSsoStatus.useQuery(
    {},
    { enabled: !!user },
  );

  const isOnOwnPersonalProject = !!team?.isPersonal && team.ownerUserId === user?.id;

  // Admin viewing-as detection: an organization administrator is on a project
  // that belongs to ANOTHER person's personal workspace. That is the only
  // legitimate "using administrative reach to read somebody else's data" case:
  // organization ADMIN cascades to every team as implicit membership, so a
  // team-kind banner would shout at an administrator on their own dashboards.
  //
  // Gated to project-anchored addresses ONLY — the administrator's own
  // surfaces (/governance, /settings/*, /me/*, /ops/*) must not fire the
  // banner even when the team is still resolved from a project visited
  // earlier.
  const isProjectAnchoredRoute = !!project && pathname.startsWith(`/${project.slug}`);
  const adminViewingAs: { label: string } | null =
    isProjectAnchoredRoute &&
    organizationRole === ORGANIZATION_ADMIN_ROLE &&
    team?.isPersonal &&
    team.ownerUserId !== user?.id
      ? { label: team.name }
      : null;
  const isPersonalScopeRoute =
    personalScope || pathname.startsWith("/me") || isOnOwnPersonalProject;

  // Audit emission for cross-scope reads. Fires once per project the
  // administrator drills into. Fail-quiet: a refused emission must not stop
  // the page rendering.
  const recordWorkspaceView = navigationApi.governance.recordWorkspaceView.useMutation();
  const targetTeamId = adminViewingAs ? team?.id : void 0;
  const workspaceLabel = adminViewingAs?.label;
  const organizationId = organization?.id;
  const isRecording = recordWorkspaceView.isPending;
  const record = recordWorkspaceView.mutate;
  useEffect(() => {
    if (!targetTeamId || !organizationId || !workspaceLabel || isRecording) return;
    record({
      organizationId,
      targetTeamId,
      kind: "personal",
      workspaceLabel,
    });
    // The identity of the workspace is what a new emission turns on; the
    // mutation object is new on every render and would fire a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetTeamId, organizationId, workspaceLabel]);

  // Requires BOTH sides present: an install with no demo project configured
  // leaves the slug undefined, and `===` against an equally-undefined project
  // slug would read as a match on any address that has not resolved one yet.
  const isDemoProject =
    !!deployment.demoProjectSlug && deployment.demoProjectSlug === project?.slug;

  const userIsPartOfTeam =
    // Personal-scope addresses are the reader's by construction, even when
    // membership of the ambient team cannot be confirmed. Without this clause
    // a member on /me/* hits the "not part of any team" overlay and the page
    // never renders.
    isPersonalScopeRoute ||
    isDemoProject ||
    // The same predicate the host's own ambient team resolution prefers on, so
    // the team the application picks and the team the chrome renders for
    // cannot diverge.
    (!!team && !!user?.id && (team.members ?? []).some((member) => member.userId === user.id)) ||
    // Administrators created through a role binding alone have no membership
    // row and still have full team access.
    organizationRole === ORGANIZATION_ADMIN_ROLE;

  return (
    <VStack width="full" gap={0} {...props}>
      {(!deployment.hasNlpService || !deployment.hasLangevals) && (
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
              Please check your environment variables, the following variables are not set
              which are required for evaluations and workflows:
            </Text>
            {!deployment.hasNlpService && <Text>LANGWATCH_NLP_SERVICE</Text>}
            {!deployment.hasLangevals && <Text>LANGEVALS_ENDPOINT</Text>}
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
              <NavigationLink
                href={planManagementHref(deployment.isSaaS)}
                textDecoration="underline"
                _hover={{ textDecoration: "none" }}
              >
                Click here
              </NavigationLink>{" "}
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
              {usage.data.maxMonthlyUsageLimit.toLocaleString(void 0, {
                style: "currency",
                currency: "USD",
              })}{" "}
              usage cost for this month, evaluations and guardrails will not be processed.{" "}
              <NavigationLink
                href="/settings/usage"
                textDecoration="underline"
                _hover={{ textDecoration: "none" }}
              >
                Go to settings
              </NavigationLink>{" "}
              to check your usage spending limit or upgrade your plan.
            </Text>
          </Alert.Content>
        </Alert.Root>
      )}

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
                  Your organization requires SSO login. Please link your account by logging
                  in via the email input box on the sign-in page.
                </Text>
              </VStack>
              <Button size="sm" colorPalette="red" flexShrink={0} color="white" asChild>
                <NavigationLink href="/settings/authentication">
                  <KeyRound size={14} />
                  Link SSO Account
                </NavigationLink>
              </Button>
            </HStack>
          </Alert.Content>
        </Alert.Root>
      )}

      {isDemoProject && (
        <HStack width="full" backgroundColor="orange.400" padding={1}>
          <Spacer />
          <Text fontSize="sm">
            Viewing Demo Project - Go back to yours{" "}
            <NavigationLink href="/" textDecoration="underline">
              here
            </NavigationLink>
          </Text>
          <Spacer />
        </HStack>
      )}

      {userIsPartOfTeam ? (
        // The page body absorbs the leftover vertical space inside the
        // scrolling stack. Without `flex: 1` + `minHeight: 0`, a page using
        // `height="full"` reads it as the whole stack — banners included — so
        // showing one pushed the bottom of the page off the viewport.
        <Box flex="1" minHeight={0} width="full" display="flex" flexDirection="column">
          <ErrorBoundary FallbackComponent={PageErrorFallback} resetKeys={[pathname]}>
            {children}
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
                You are not part of any team in this organization. Ask your administrator to
                add you, or{" "}
                <NavigationLink href="/" textDecoration="underline">
                  go back to your home page
                </NavigationLink>
                .
              </Text>
            </HStack>
          </Alert.Content>
        </Alert.Root>
      )}
    </VStack>
  );
};
