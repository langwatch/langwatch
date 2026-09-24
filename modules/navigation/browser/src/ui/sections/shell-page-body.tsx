/**
 * Shell page body: content card interior. Moved from platform/app.
 * Drawer/announcements/analytics/SavedViews moved or removed.
 */

import {
  Alert,
  Box,
  Button,
  Container,
  HStack,
  Spacer,
  type StackProps,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useEffect, type ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { navigationApi } from "../../behavior/navigation-api.ts";
import { type NavigationTeam, useNavigationHost } from "../../model/navigation-host.ts";
import { planManagementHref } from "../../model/plan-management-href.ts";
import { isSettingsShellRoute } from "../../model/products.ts";
import { isResolverAddress } from "../../model/resolve-shell-route.ts";
import { AdminViewingAsBanner } from "../blocks/admin-viewing-as-banner.tsx";
import { NavigationLink } from "../elements/navigation-link.tsx";
import { PageErrorFallback } from "../elements/page-error-fallback.tsx";

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
 * The organization role that carries administrative reach across every
 * team, spelled the wire's own way: the enum it came from is Prisma's,
 * which a governed web package may not import.
 */
const ORGANIZATION_ADMIN_ROLE = "ADMIN";

/**
 * Whether the page draws for this reader, or the "not part of any team"
 * refusal does. Lifted out of the component so the chrome's one refusal
 * decision reads on its own, and the component stays inside its budget.
 */
function readerMayOpenThePage({
  pathname,
  isPersonalScopeRoute,
  isDemoProject,
  team,
  userId,
  organizationRole,
}: {
  pathname: string;
  isPersonalScopeRoute: boolean;
  isDemoProject: boolean;
  team: NavigationTeam | undefined;
  userId: string | undefined;
  organizationRole: string | undefined;
}): boolean {
  // The resolver refuses nobody: it renders a redirect, and its refusal's one
  // link points back at itself. Membership is the destination's question.
  if (isResolverAddress(pathname)) return true;
  // Personal-scope addresses are the reader's by construction, even when
  // membership of the ambient team cannot be confirmed: without this a member
  // on /me/* hits the refusal and the page never renders.
  if (isPersonalScopeRoute || isDemoProject) return true;
  // Administrators created through a role binding alone have no membership row
  // and still have full team access.
  if (organizationRole === ORGANIZATION_ADMIN_ROLE) return true;
  // The same predicate the host's own ambient team resolution prefers on, so
  // the team the application picks and the one the chrome draws cannot diverge.
  return !!team && !!userId && (team.members ?? []).some((member) => member.userId === userId);
}

/**
 * The settings detour is read at a measure, centred in the width left beside
 * the menu — a settings form flush against the sidebar is what this stops.
 */
function PageMeasure({ pathname, children }: { pathname: string; children: ReactNode }) {
  if (!isSettingsShellRoute(pathname)) return <>{children}</>;
  return (
    <Container
      maxWidth="1280px"
      padding={4}
      paddingBottom={16}
      height="full"
      overflowY="auto"
      flex={1}
    >
      {children}
    </Container>
  );
}

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
  const isOrganizationLoading = host.isLoading();

  const usage = navigationApi.limits.getUsage.useQuery(
    { organizationId: organization?.id ?? "" },
    {
      enabled: !!organization && host.hasPermission("organization:view"),
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    },
  );
  const { data: ssoStatus } = navigationApi.user.getSsoStatus.useQuery({}, { enabled: !!user });

  const isOnOwnPersonalProject = !!team?.isPersonal && team.ownerUserId === user?.id;

  // Admin viewing-as: org admin on personal workspace. Gated to project addresses.
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

  const userIsPartOfTeam = readerMayOpenThePage({
    pathname,
    isPersonalScopeRoute,
    isDemoProject,
    team,
    userId: user?.id,
    organizationRole,
  });

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
              Please check your environment variables, the following variables are not set which are
              required for evaluations and workflows:
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

      {host.startupNotice()}

      {host.joinOffer({
        currentOrganizationId: isOrganizationLoading ? void 0 : (organization?.id ?? null),
      })}

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
                  Sign in with your organization's single sign-on
                </Alert.Title>
                <Text fontSize="sm">
                  Your organization requires single sign-on. Sign out, then sign in again by
                  entering your work email address.
                </Text>
              </VStack>
              <Button
                size="sm"
                colorPalette="red"
                flexShrink={0}
                color="white"
                onClick={() => host.signOut()}
              >
                Sign out
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

      {userIsPartOfTeam || isOrganizationLoading ? (
        // A refusal is drawn only from an answered organization read, so the
        // body renders while it is out. `flex: 1` + `minHeight: 0` keep a
        // `height="full"` page from reading the whole stack, banners included.
        <Box flex="1" minHeight={0} width="full" display="flex" flexDirection="column">
          <ErrorBoundary FallbackComponent={PageErrorFallback} resetKeys={[pathname]}>
            <PageMeasure pathname={pathname}>{children}</PageMeasure>
          </ErrorBoundary>
        </Box>
      ) : (
        (host.teamAccessWaiting({
          organizationName: organization?.name ?? "your organization",
        }) ?? (
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
                  You are not part of any team in this organization. Ask your administrator to add
                  you, or{" "}
                  <NavigationLink href="/" textDecoration="underline">
                    go back to your home page
                  </NavigationLink>
                  .
                </Text>
              </HStack>
            </Alert.Content>
          </Alert.Root>
        ))
      )}
    </VStack>
  );
};
