import { Box, Text, VStack } from "@chakra-ui/react";
import type { Project } from "@prisma/client";
import { Activity, Anvil, Film, History, Shield } from "lucide-react";
import { useRouter } from "~/utils/compat/next-router";
import React, { useState } from "react";
import { useOpsPermission } from "../hooks/useOpsPermission";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { usePublicEnv } from "../hooks/usePublicEnv";
import { api } from "../utils/api";
import { featureIcons } from "../utils/featureIcons";
import { projectRoutes } from "../utils/routes";
import { useTableView } from "./messages/HeaderButtons";
import { CollapsibleMenuGroup } from "./sidebar/CollapsibleMenuGroup";
import { SideMenuLink } from "./sidebar/SideMenuLink";
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

  const pendingItemsCount = api.annotation.getPendingItemsCount.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
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
          <VStack width="full" gap={0.5} align="start">
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

            <Text
              fontSize="11px"
              fontWeight="medium"
              textTransform="uppercase"
              color="gray.500"
              paddingX={2}
              paddingTop={3}
              paddingBottom={1}
            >
              {showExpanded ? "Evaluate" : <div>&nbsp;</div>}
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
                  isActive: router.pathname.includes(
                    "/simulations/scenarios",
                  ),
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
              {showExpanded ? "Library" : <div>&nbsp;</div>}
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
  const alwaysShow =
    publicEnv.data?.SHOW_OPS_IN_MAIN_SIDEBAR ?? false;
  const isOnOpsRoute = router.pathname.startsWith("/ops");
  const shouldShow = hasAccess && (alwaysShow || isOnOpsRoute);

  const opsData = api.ops.getDashboardSnapshot.useQuery(undefined, {
    enabled: shouldShow,
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

  const blockedCount =
    opsData.data?.queues.reduce((sum, q) => sum + q.blockedGroupCount, 0) ?? 0;
  const dlqCount =
    opsData.data?.queues.reduce((sum, q) => sum + q.dlqCount, 0) ?? 0;

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
        {showExpanded ? "Ops" : <div>&nbsp;</div>}
      </Text>
      <SideMenuLink
        icon={Activity}
        label="Dashboard"
        href="/ops"
        isActive={router.pathname === "/ops" || router.pathname.startsWith("/ops/queues")}
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
          href="/ops/backoffice"
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
};

const PageMenuLink = ({
  icon,
  label,
  path,
  project,
  badgeNumber,
  isActive,
  showLabel = true,
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
    />
  );
};
