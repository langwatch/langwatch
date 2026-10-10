/**
 * Shell page body: content card interior. Moved from platform/app.
 * Drawer/announcements/analytics moved or removed; the saved-views strip is analytics' own.
 */

import { Banner, BannerAction } from "@langwatch/design-system/banner";
import { Box, type StackProps, VStack } from "@langwatch/design-system/primitives";
import type { NavigationTeam } from "@langwatch/navigation-contract";
import { useEffect, type ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { navigationApi } from "../../behavior/navigation-api.ts";
import { useNavigationHost } from "../../model/navigation-host.ts";
import { planManagementHref } from "../../model/plan-management-href.ts";
import { isPathUnder } from "../../model/products.ts";
import { isResolverAddress } from "../../model/resolve-shell-route.ts";
import { cloudAdminGroup, instanceGroup } from "../../model/settings-menu.ts";
import { AdminViewingAsBanner } from "../blocks/admin-viewing-as-banner.tsx";
import { SeatLimitBanner } from "../blocks/seat-limit-banner.tsx";
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

/** The service variables evaluations and workflows need that this deployment has not set. */
const missingServiceVariables = (deployment: { hasNlpService: boolean; hasLangevals: boolean }) => [
  ...(deployment.hasNlpService ? [] : ["LANGWATCH_NLP_SERVICE"]),
  ...(deployment.hasLangevals ? [] : ["LANGEVALS_ENDPOINT"]),
];

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

const MEASURED_OPS_PAGES = [...instanceGroup().items, ...cloudAdminGroup().items];

/** Sparse pages (forms, a few rows, an empty state) read narrow; tables keep the wider measure. */
const FORM_PAGES = [
  "/settings",
  "/settings/profile",
  "/settings/security",
  "/settings/checkup",
  "/settings/data-privacy",
  "/settings/license",
  "/settings/connect",
  "/settings/integrations",
];
const FORM_MEASURE = "820px";
/** Your own account pages sit at the left, as on main, behind a fixed margin. */
const LEFT_ALIGNED_PAGES = ["/settings/profile", "/settings/security"];
const TABLE_MEASURE = "1280px";

/** Forms read narrow, tables wide. */
function measureOf(pathname: string): string {
  return FORM_PAGES.includes(pathname) ? FORM_MEASURE : TABLE_MEASURE;
}

/**
 * Settings and gateway pages are read at a centred measure, as main's SettingsLayout framed them;
 * authentication's section rail takes the full width, as main's fullBleed did.
 * Ops tools other than instance and Cloud admin draw their own frame and get none here.
 */
function PageMeasure({ pathname, children }: { pathname: string; children: ReactNode }) {
  const isMeasured =
    (isPathUnder({ pathname, base: "/settings" }) &&
      !isPathUnder({ pathname, base: "/settings/authentication" })) ||
    isPathUnder({ pathname, base: "/gateway" }) ||
    MEASURED_OPS_PAGES.some((item) => isPathUnder({ pathname, base: item.href }));
  if (!isMeasured) return <>{children}</>;
  const measure = measureOf(pathname);
  const isLeftAligned = LEFT_ALIGNED_PAGES.includes(pathname);
  const inset = isLeftAligned
    ? "var(--chakra-spacing-8)"
    : `max(var(--chakra-spacing-6), calc((100% - ${measure}) / 2))`;
  return (
    <Box
      data-page-measure={measure}
      data-page-align={isLeftAligned ? "start" : "center"}
      flex={1}
      minHeight={0}
      overflowY="auto"
      paddingBottom={16}
      // The header's border spans the card; its title, actions and every block
      // under it sit in one column of the measure, centred in the card.
      // Buttons are skipped: the assistant's floating launcher is a fixed sibling.
      css={{
        "--page-inset": inset,
        "& [data-page-header]": { paddingInline: "var(--page-inset)" },
        "& [data-page-header] ~ :not(button), &:not(:has([data-page-header])) > :not(button)": {
          width: "calc(100% - 2 * var(--page-inset))",
          marginInline: "var(--page-inset)",
        },
        "& [data-page-container]": { paddingInline: 0 },
      }}
    >
      {children}
    </Box>
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

  // A refusal is drawn only from an answered organization read, so the body renders
  // while it is out; `flex: 1` + `minHeight: 0` keep a `height="full"` page inside.
  const body =
    userIsPartOfTeam || isOrganizationLoading ? (
      <Box flex="1" minHeight={0} width="full" display="flex" flexDirection="column">
        <ErrorBoundary FallbackComponent={PageErrorFallback} resetKeys={[pathname]}>
          <PageMeasure pathname={pathname}>{children}</PageMeasure>
        </ErrorBoundary>
      </Box>
    ) : (
      (host.teamAccessWaiting({
        organizationName: organization?.name ?? "your organization",
      }) ?? (
        <Banner status="warning" placement="top">
          You are not part of any team in this organization. Ask your administrator to add you, or{" "}
          <NavigationLink href="/" textDecoration="underline">
            go back to your home page
          </NavigationLink>
          .
        </Banner>
      ))
    );

  return (
    <VStack width="full" gap={0} {...props}>
      {/* Banners are chrome: a positioned layer so a page's own zIndex or bleed (the home
          hero's bloom) cannot wash them out; `docked` stays under every portaled overlay. */}
      <VStack width="full" gap={0} position="relative" zIndex="docked" data-part="page-banners">
        {(!deployment.hasNlpService || !deployment.hasLangevals) && (
          <Banner
            status="warning"
            placement="top"
            title="Evaluations and workflows are off: environment variables are missing."
          >
            Set {missingServiceVariables(deployment).join(" and ")}.
          </Banner>
        )}
        {usage.data?.messageLimitInfo && usage.data.messageLimitInfo.status !== "ok" && (
          <Banner
            status={usage.data.messageLimitInfo.status === "exceeded" ? "error" : "warning"}
            placement="top"
            title={usage.data.messageLimitInfo.message}
            action={
              <BannerAction asChild>
                <NavigationLink href={planManagementHref(deployment.isSaaS)}>
                  Upgrade your plan
                </NavigationLink>
              </BannerAction>
            }
          />
        )}
        {usage.data?.seatLimitInfo?.status === "exceeded" && (
          <SeatLimitBanner
            message={usage.data.seatLimitInfo.message}
            isEnterprisePlan={usage.data.activePlan.type === "ENTERPRISE"}
            planManagementHref={planManagementHref(deployment.isSaaS)}
          />
        )}
        {usage.data && usage.data.currentMonthCost > usage.data.maxMonthlyUsageLimit && (
          <Banner
            status="warning"
            placement="top"
            title={`You reached the limit of ${usage.data.maxMonthlyUsageLimit.toLocaleString(
              void 0,
              {
                style: "currency",
                currency: "USD",
              },
            )} usage cost for this month.`}
            action={
              <BannerAction asChild>
                <NavigationLink href="/settings/usage">Go to settings</NavigationLink>
              </BannerAction>
            }
          >
            Evaluations and guardrails will not be processed until you raise your spending limit or
            upgrade your plan.
          </Banner>
        )}

        {host.joinOffer({
          currentOrganizationId: isOrganizationLoading ? void 0 : (organization?.id ?? null),
        })}

        {adminViewingAs && <AdminViewingAsBanner workspaceLabel={adminViewingAs.label} />}

        {ssoStatus?.pendingSsoSetup && (
          <Banner
            status="error"
            placement="top"
            title="Sign in with your organization's single sign-on"
            action={<BannerAction onClick={() => host.signOut()}>Sign out</BannerAction>}
          >
            Your organization requires single sign-on. Sign out, then sign in again by entering your
            work email address.
          </Banner>
        )}

        {isDemoProject && (
          <Banner
            status="info"
            placement="top"
            title="You are viewing the demo project."
            action={
              <BannerAction asChild>
                <NavigationLink href="/">Go back to yours</NavigationLink>
              </BannerAction>
            }
          />
        )}
      </VStack>

      {/* The enrolment gate (D06) swaps the body and leaves the chrome, so the switcher
          still reaches every organization the reader is not held out of. */}
      {host.organizationMfaGate({
        organizationId: organization?.id,
        isPersonalScope: isPersonalScopeRoute,
        body,
      })}
    </VStack>
  );
};
