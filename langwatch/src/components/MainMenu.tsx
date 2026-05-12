import { Badge, Box, HStack, Text, VStack } from "@chakra-ui/react";
import type { Project } from "@prisma/client";
import {
  Activity,
  Anvil,
  Film,
  Gauge,
  History,
  KeyRound,
  LineChart,
  Plug,
  Shield,
  Zap,
} from "lucide-react";
import { useRouter } from "~/utils/compat/next-router";
import React, { useState } from "react";
import { useOpsPermission } from "../hooks/useOpsPermission";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { useFeatureFlag } from "../hooks/useFeatureFlag";
import { usePublicEnv } from "../hooks/usePublicEnv";
import { api } from "../utils/api";
import { featureIcons } from "../utils/featureIcons";
import { projectRoutes } from "../utils/routes";
import { useTableView } from "./messages/HeaderButtons";
import { CollapsibleMenuGroup } from "./sidebar/CollapsibleMenuGroup";
import { SideMenuLink } from "./sidebar/SideMenuLink";
import { PresenceToggle } from "./sidebar/PresenceToggle";
import { SupportMenu } from "./sidebar/SupportMenu";
import { ThemeToggle } from "./sidebar/ThemeToggle";
import { UsageIndicator } from "./sidebar/UsageIndicator";

export const MENU_WIDTH_EXPANDED = "200px";
export const MENU_WIDTH_COMPACT = "56px";
export const MENU_WIDTH = MENU_WIDTH_EXPANDED;

export type MainMenuProps = {
  isCompact?: boolean;
};

export const MainMenu = React.memo(function MainMenu({
  isCompact = false,
}: MainMenuProps) {
  const router = useRouter();
  const { project, hasPermission, isPublicRoute } =
    useOrganizationTeamProject();
  const [isHovered, setIsHovered] = useState(false);

  const { enabled: tracesV2Enabled } = useFeatureFlag(
    "release_ui_traces_v2_enabled",
    { projectId: project?.id, enabled: !!project },
  );

  const pendingItemsCount = api.annotation.getPendingItemsCount.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );

  // AI Gateway menu is feature-flagged pre-GA. Flip it on for internal
  // dogfooding by setting FEATURE_FLAG_FORCE_ENABLE=release_ui_ai_gateway_menu_enabled
  // on the server (see featureFlagService.posthog.ts). Otherwise targeting
  // is driven by PostHog release conditions.
  const { enabled: gatewayMenuEnabled } = useFeatureFlag(
    "release_ui_ai_gateway_menu_enabled",
    { projectId: project?.id, enabled: !!project },
  );

  // In compact mode, show expanded view on hover
  const showExpanded = !isCompact || isHovered;
  const currentWidth = showExpanded ? MENU_WIDTH_EXPANDED : MENU_WIDTH_COMPACT;

  return (
    <Box
      background="bg.page"
      width={isCompact ? MENU_WIDTH_COMPACT : MENU_WIDTH_EXPANDED}
      minWidth={isCompact ? MENU_WIDTH_COMPACT : MENU_WIDTH_EXPANDED}
      height="calc(100vh - 60px)"
      position="relative"
      onMouseEnter={() => isCompact && setIsHovered(true)}
      onMouseLeave={() => isCompact && setIsHovered(false)}
    >
      <Box
        position={isCompact ? "absolute" : "relative"}
        zIndex={isCompact ? 100 : "auto"}
        top={0}
        left={0}
        width={currentWidth}
        height="calc(100vh - 60px)"
        background="bg.page"
        transition="width 0.15s ease-in-out"
        overflow="hidden"
      >
        <VStack
          paddingX={2}
          paddingTop={2}
          paddingBottom={2}
          gap={0}
          height="100%"
          align="start"
          width={MENU_WIDTH_EXPANDED}
          justifyContent="space-between"
        >
          <VStack
            width="full"
            gap={0.5}
            align="start"
            flex={1}
            minHeight={0}
            overflowY="auto"
            overflowX="hidden"
            css={{
              scrollbarWidth: "thin",
              "&::-webkit-scrollbar": { width: "4px" },
              "&::-webkit-scrollbar-thumb": {
                background: "var(--chakra-colors-border-emphasized)",
                borderRadius: "2px",
              },
              "&::-webkit-scrollbar-track": { background: "transparent" },
            }}
          >
            <PageMenuLink
              path={projectRoutes.home.path}
              icon={featureIcons.home.icon}
              label={projectRoutes.home.title}
              project={project}
              isActive={
                router.pathname === "/[project]" &&
                !router.pathname.includes("/analytics")
              }
              showLabel={showExpanded}
            />

            <Text
              fontSize="11px"
              fontWeight="medium"
              textTransform="uppercase"
              color="gray.500"
              paddingX={2}
              paddingTop={3}
              paddingBottom={1}
            >
              {showExpanded ? "Observe" : <>&nbsp;</>}
            </Text>

            <PageMenuLink
              path={projectRoutes.analytics.path}
              icon={featureIcons.analytics.icon}
              label={projectRoutes.analytics.title}
              project={project}
              isActive={router.pathname.includes("/analytics")}
              showLabel={showExpanded}
            />
            <PageMenuLink
              path={projectRoutes.messages.path}
              icon={featureIcons.traces.icon}
              label={projectRoutes.messages.title}
              project={project}
              isActive={router.pathname.includes("/messages")}
              showLabel={showExpanded}
            />
            {tracesV2Enabled && (
              <PageMenuLink
                path={projectRoutes.traces_v2.path}
                icon={featureIcons.traces_v2.icon}
                label={projectRoutes.traces_v2.title}
                project={project}
                isActive={router.pathname.includes("/traces")}
                showLabel={showExpanded}
                beta="Trace Explorer is in beta — expect rough edges. Share feedback or report issues on Slack, or open one at https://github.com/langwatch/langwatch/issues/new/choose."
                betaLabel="Beta"
              />
            )}

            <Text
              fontSize="11px"
              fontWeight="medium"
              textTransform="uppercase"
              color="gray.500"
              paddingX={2}
              paddingTop={3}
              paddingBottom={1}
            >
              {showExpanded ? "Evaluate" : <>&nbsp;</>}
            </Text>

            <CollapsibleMenuGroup
              icon={featureIcons.simulations.icon}
              label={projectRoutes.simulations.title}
              project={project}
              showLabel={showExpanded}
              children={[
                {
                  icon: featureIcons.scenarios.icon,
                  label: projectRoutes.scenarios.title,
                  href: project
                    ? projectRoutes.scenarios.path.replace(
                        "[project]",
                        project.slug,
                      )
                    : "/auth/signin",
                  isActive: router.pathname.includes("/simulations/scenarios"),
                },
                {
                  icon: featureIcons.simulation_runs.icon,
                  label: projectRoutes.simulation_runs.title,
                  href: project
                    ? projectRoutes.simulation_runs.path.replace(
                        "[project]",
                        project.slug,
                      )
                    : "/auth/signin",
                  isActive:
                    router.pathname.includes("/simulations") &&
                    !router.pathname.includes("/simulations/scenarios"),
                },
              ]}
            />

            <PageMenuLink
              path={projectRoutes.evaluations.path}
              icon={featureIcons.evaluations.icon}
              label={projectRoutes.evaluations.title}
              project={project}
              isActive={
                router.pathname.includes("/evaluations") &&
                !router.pathname.includes("/analytics")
              }
              showLabel={showExpanded}
            />

            <PageMenuLink
              path={projectRoutes.annotations.path}
              icon={featureIcons.annotations.icon}
              label={projectRoutes.annotations.title}
              project={project}
              badgeNumber={pendingItemsCount.data}
              isActive={router.pathname.includes("/annotations")}
              showLabel={showExpanded}
            />

            <Text
              fontSize="11px"
              fontWeight="medium"
              textTransform="uppercase"
              color="gray.500"
              paddingX={2}
              paddingTop={3}
              paddingBottom={1}
            >
              {showExpanded ? "Library" : <>&nbsp;</>}
            </Text>

            <PageMenuLink
              path={projectRoutes.prompts.path}
              icon={featureIcons.prompts.icon}
              label={projectRoutes.prompts.title}
              project={project}
              isActive={router.pathname.includes("/prompts")}
              showLabel={showExpanded}
            />

            <PageMenuLink
              path={projectRoutes.agents.path}
              icon={featureIcons.agents.icon}
              label={projectRoutes.agents.title}
              project={project}
              isActive={router.pathname.includes("/agents")}
              showLabel={showExpanded}
            />

            <PageMenuLink
              path={projectRoutes.workflows.path}
              icon={featureIcons.workflows.icon}
              label={projectRoutes.workflows.title}
              project={project}
              isActive={router.pathname.includes("/workflows")}
              showLabel={showExpanded}
            />

            <PageMenuLink
              path={projectRoutes.evaluators.path}
              icon={featureIcons.evaluators.icon}
              label={projectRoutes.evaluators.title}
              project={project}
              isActive={router.pathname.includes("/evaluators")}
              showLabel={showExpanded}
            />

            <PageMenuLink
              path={projectRoutes.datasets.path}
              icon={featureIcons.datasets.icon}
              label={projectRoutes.datasets.title}
              project={project}
              isActive={router.pathname.includes("/datasets")}
              showLabel={showExpanded}
            />

            {gatewayMenuEnabled && hasPermission("virtualKeys:view") && project && (
              <>
                {" "}
                <HStack
                  paddingX={2}
                  paddingTop={3}
                  paddingBottom={1}
                  gap={1}
                  align="center"
                >
                  <Text
                    fontSize="11px"
                    fontWeight="medium"
                    textTransform="uppercase"
                    color="gray.500"
                  >
                    {showExpanded ? "Gateway" : <>&nbsp;</>}
                  </Text>
                  {showExpanded && (
                    <Badge
                      colorPalette="blue"
                      variant="subtle"
                      fontSize="2xs"
                      paddingX={1.5}
                      lineHeight={1.2}
                    >
                      Beta
                    </Badge>
                  )}
                </HStack>
                <CollapsibleMenuGroup
                  icon={featureIcons.gateway.icon}
                  label={projectRoutes.gateway.title}
                  project={project}
                  showLabel={showExpanded}
                  children={[
                    {
                      icon: KeyRound,
                      label: projectRoutes.gateway_virtual_keys.title,
                      href: projectRoutes.gateway_virtual_keys.path.replace(
                        "[project]",
                        project.slug,
                      ),
                      isActive: router.pathname.includes(
                        "/gateway/virtual-keys",
                      ),
                    },
                    ...(hasPermission("gatewayBudgets:view")
                      ? [
                          {
                            icon: Gauge,
                            label: projectRoutes.gateway_budgets.title,
                            href: projectRoutes.gateway_budgets.path.replace(
                              "[project]",
                              project.slug,
                            ),
                            isActive:
                              router.pathname.includes("/gateway/budgets"),
                          },
                        ]
                      : []),
                    ...(hasPermission("gatewayProviders:view")
                      ? [
                          {
                            icon: Plug,
                            label: projectRoutes.gateway_providers.title,
                            href: projectRoutes.gateway_providers.path.replace(
                              "[project]",
                              project.slug,
                            ),
                            isActive:
                              router.pathname.includes("/gateway/providers"),
                          },
                        ]
                      : []),
                    ...(hasPermission("gatewayCacheRules:view")
                      ? [
                          {
                            icon: Zap,
                            label: projectRoutes.gateway_cache_rules.title,
                            href: projectRoutes.gateway_cache_rules.path.replace(
                              "[project]",
                              project.slug,
                            ),
                            isActive: router.pathname.includes(
                              "/gateway/cache-rules",
                            ),
                          },
                        ]
                      : []),
                    ...(hasPermission("gatewayUsage:view")
                      ? [
                          {
                            icon: LineChart,
                            label: projectRoutes.gateway_usage.title,
                            href: projectRoutes.gateway_usage.path.replace(
                              "[project]",
                              project.slug,
                            ),
                            isActive:
                              router.pathname.endsWith("/gateway/usage"),
                          },
                        ]
                      : []),
                    // Audit log entry removed — gateway audit rows are now
                    // surfaced under /settings/audit-log alongside platform
                    // governance events. Deep-links from VK / Budget detail
                    // pages target /settings/audit-log directly.
                  ]}
                />
              </>
            )}

            <OpsSection showExpanded={showExpanded} />
          </VStack>

          <VStack width="full" gap={0.5} align="start">
            <UsageIndicator showLabel={showExpanded} />
            {(!!hasPermission("organization:view") || isPublicRoute) && (
              <PageMenuLink
                path={projectRoutes.settings.path}
                icon={featureIcons.settings.icon}
                label={projectRoutes.settings.title}
                project={project}
                isActive={router.pathname.includes("/settings")}
                showLabel={showExpanded}
              />
            )}
            <SupportMenu showLabel={showExpanded} />
            <PresenceToggle showLabel={showExpanded} />
            <ThemeToggle showLabel={showExpanded} />
          </VStack>
        </VStack>
      </Box>
    </Box>
  );
});

const OpsSection = ({ showExpanded }: { showExpanded: boolean }) => {
  const router = useRouter();
  const { hasAccess } = useOpsPermission();
  const publicEnv = usePublicEnv();
  const alwaysShow = publicEnv.data?.SHOW_OPS_IN_MAIN_SIDEBAR ?? false;
  const isOnOpsRoute = router.pathname.startsWith("/ops");
  const shouldShow = hasAccess && (alwaysShow || isOnOpsRoute);

  // Two-tier polling so the always-on global badge doesn't drag the full
  // dashboard aggregation into every tRPC batch. tRPC's `httpBatchLink`
  // bundles multiple queries that fire in the same ~10ms window into one
  // HTTP request and waits on every procedure before responding — so a
  // slow `getDashboardSnapshot` call running in the background here would
  // stall every page-level query batched alongside it. Off-route we ask
  // only for the two integers the badge renders; on-route we lift to the
  // full snapshot since the user actually wants the data.
  const opsBadge = api.ops.getBadgeCounts.useQuery(undefined, {
    enabled: shouldShow && !isOnOpsRoute,
    refetchInterval: 60000,
  });
  const opsData = api.ops.getDashboardSnapshot.useQuery(undefined, {
    enabled: shouldShow && isOnOpsRoute,
    refetchInterval: 10000,
  });

  // Backoffice is admin-only. `useOpsPermission` already gates the whole
  // OPS section on admin today, but we keep the isAdmin query decoupled so
  // that if ops:view ever broadens beyond admin, the Backoffice link still
  // stays strictly admin-only. Gated on `shouldShow` so the request is
  // skipped entirely when the section isn't rendered.
  const adminStatus = api.user.isAdmin.useQuery(
    {},
    { enabled: shouldShow, retry: false, refetchOnWindowFocus: false },
  );
  const isAdminUser = adminStatus.data?.isAdmin ?? false;

  if (!shouldShow) return null;

  // On-route: derive from the full snapshot the dashboard already loaded.
  // Off-route: read from the lightweight badge counts. Either way the
  // badge stays in sync.
  const blockedCount = isOnOpsRoute
    ? opsData.data?.queues.reduce((sum, q) => sum + q.blockedGroupCount, 0) ?? 0
    : opsBadge.data?.blockedCount ?? 0;
  const dlqCount = isOnOpsRoute
    ? opsData.data?.queues.reduce((sum, q) => sum + q.dlqCount, 0) ?? 0
    : opsBadge.data?.dlqCount ?? 0;

  return (
    <>
      <Text
        fontSize="11px"
        fontWeight="medium"
        textTransform="uppercase"
        color="gray.500"
        paddingX={2}
        paddingTop={3}
        paddingBottom={1}
      >
        {showExpanded ? "Ops" : <>&nbsp;</>}
      </Text>
      <SideMenuLink
        icon={Activity}
        label="Dashboard"
        href="/ops"
        isActive={
          router.pathname === "/ops" ||
          router.pathname.startsWith("/ops/queues")
        }
        badgeNumber={blockedCount + dlqCount}
        showLabel={showExpanded}
      />
      <SideMenuLink
        icon={Film}
        label="Projection Replay"
        href="/ops/projections"
        isActive={router.pathname.startsWith("/ops/projections")}
        showLabel={showExpanded}
      />
      <SideMenuLink
        icon={Anvil}
        label="The Foundry"
        href="/ops/foundry"
        isActive={router.pathname.startsWith("/ops/foundry")}
        showLabel={showExpanded}
      />
      <SideMenuLink
        icon={History}
        label="Deja View"
        href="/ops/dejaview"
        isActive={router.pathname.startsWith("/ops/dejaview")}
        showLabel={showExpanded}
      />
      {isAdminUser && (
        <SideMenuLink
          icon={Shield}
          label="Backoffice"
          href="/ops/backoffice/users"
          isActive={router.pathname.startsWith("/ops/backoffice")}
          showLabel={showExpanded}
        />
      )}
    </>
  );
};

type PageMenuLinkProps = {
  icon: React.ComponentType<{ size?: string | number; color?: string }>;
  label: string;
  path: string;
  project?: Project;
  badgeNumber?: number;
  isActive: boolean;
  showLabel?: boolean;
  beta?: string | boolean;
  betaLabel?: string;
};

const PageMenuLink = ({
  icon,
  label,
  path,
  project,
  badgeNumber,
  isActive,
  showLabel = true,
  beta,
  betaLabel,
}: PageMenuLinkProps) => {
  const { isTableView } = useTableView();

  const viewModeQuery = path.includes("/messages")
    ? isTableView
      ? "?view=table"
      : "?view=list"
    : "";

  return (
    <SideMenuLink
      icon={icon}
      label={label}
      href={
        project
          ? path.replace("[project]", project.slug) + viewModeQuery
          : "/auth/signin"
      }
      isActive={isActive}
      badgeNumber={badgeNumber}
      showLabel={showLabel}
      beta={beta}
      betaLabel={betaLabel}
    />
  );
};
