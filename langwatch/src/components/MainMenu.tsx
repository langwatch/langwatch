import { Box, VStack } from "@chakra-ui/react";
import type { Project } from "@prisma/client";
import {
  BookText,
  CheckSquare,
  ListTree,
  Pencil,
  Play,
  Settings,
  Table,
  TrendingUp,
  Workflow,
} from "lucide-react";
import { useRouter } from "next/router";
import React, { useState } from "react";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { OrganizationRoleGroup } from "../server/api/permission";
import { api } from "../utils/api";
import { projectRoutes } from "../utils/routes";
import { PuzzleIcon } from "./icons/PuzzleIcon";
import { useTableView } from "./messages/HeaderButtons";
import { SideMenuLink } from "./sidebar/SideMenuLink";
import { SupportMenu } from "./sidebar/SupportMenu";
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
  const { project, hasOrganizationPermission, isPublicRoute } =
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
      background="gray.100"
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
        background="gray.100"
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
              icon={TrendingUp}
              label={projectRoutes.home.title}
              project={project}
              isActive={
                router.pathname === "/[project]" ||
                router.pathname.includes("/analytics")
              }
              showLabel={showExpanded}
            />
            <PageMenuLink
              path={projectRoutes.messages.path}
              icon={ListTree}
              label={projectRoutes.messages.title}
              project={project}
              isActive={router.pathname.includes("/messages")}
              showLabel={showExpanded}
            />
            <PageMenuLink
              path={projectRoutes.simulations.path}
              icon={Play}
              label={projectRoutes.simulations.title}
              project={project}
              isActive={router.pathname.includes("/simulations")}
              showLabel={showExpanded}
            />
            <PageMenuLink
              path={projectRoutes.evaluations.path}
              icon={CheckSquare}
              label={projectRoutes.evaluations.title}
              project={project}
              isActive={
                router.pathname.includes("/evaluations") &&
                !router.pathname.includes("/analytics")
              }
              showLabel={showExpanded}
            />

            <PageMenuLink
              path={projectRoutes.workflows.path}
              icon={Workflow}
              label={projectRoutes.workflows.title}
              project={project}
              isActive={router.pathname.includes("/workflows")}
              showLabel={showExpanded}
            />

            <PageMenuLink
              path={projectRoutes.prompts.path}
              icon={BookText}
              label={projectRoutes.prompts.title}
              project={project}
              isActive={router.pathname.includes("/prompts")}
              showLabel={showExpanded}
            />

            <PageMenuLink
              path={projectRoutes.datasets.path}
              icon={Table}
              label={projectRoutes.datasets.title}
              project={project}
              isActive={router.pathname.includes("/datasets")}
              showLabel={showExpanded}
            />
            <PageMenuLink
              path={projectRoutes.annotations.path}
              icon={Pencil}
              label={projectRoutes.annotations.title}
              project={project}
              badgeNumber={pendingItemsCount.data}
              isActive={router.pathname.includes("/annotations")}
              showLabel={showExpanded}
            />

            {(!!hasOrganizationPermission(
              OrganizationRoleGroup.ORGANIZATION_VIEW,
            ) ||
              isPublicRoute) && (
              <PageMenuLink
                path={projectRoutes.settings.path}
                icon={Settings}
                label={projectRoutes.settings.title}
                project={project}
                isActive={router.pathname.includes("/settings")}
                showLabel={showExpanded}
              />
            )}
          </VStack>

          <VStack width="full" gap={0.5} align="start">
            <UsageIndicator showLabel={showExpanded} />
            <SupportMenu showLabel={showExpanded} />
          </VStack>
        </VStack>
      </Box>
    </Box>
  );
});

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
