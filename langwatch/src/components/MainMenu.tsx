import {
  Badge,
  Box,
  Button,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { Project } from "@prisma/client";
import { useRouter } from "next/router";
import React, { useMemo } from "react";
import {
  Bell,
  BookOpen,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Edit,
  GitHub,
  MessageSquare,
  Settings,
  Shield,
  Table,
  TrendingUp,
  Layers,
} from "react-feather";
import { useLocalStorage } from "usehooks-ts";
import { useAnnotationQueues } from "../hooks/useAnnotationQueues";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { OrganizationRoleGroup } from "../server/api/permission";
import { findCurrentRoute, projectRoutes } from "../utils/routes";
import { trackEvent } from "../utils/tracking";
import { ChatBalloonIcon } from "./icons/ChatBalloon";
import { DiscordOutlineIcon } from "./icons/DiscordOutline";
import { LogoIcon } from "./icons/LogoIcon";
import { PuzzleIcon } from "./icons/PuzzleIcon";
import { IconWrapper } from "./IconWrapper";
import { useTableView } from "./messages/HeaderButtons";
import { useColorRawValue } from "./ui/color-mode";
import { Link } from "./ui/link";
import { Tooltip } from "./ui/tooltip";

export const MainMenu = React.memo(
  function MainMenu({ menuWidth }: { menuWidth: number }) {
    const [isExpanded, setIsExpanded] = useLocalStorage(
      "main-menu-expanded",
      false
    );

    const { project, hasOrganizationPermission, isPublicRoute } =
      useOrganizationTeamProject();
    const { assignedQueueItems, memberAccessibleQueueItems } =
      useAnnotationQueues();
    const totalQueueItems = useMemo(
      () =>
        (assignedQueueItems?.filter((item) => !item.doneAt)?.length ?? 0) +
        (memberAccessibleQueueItems?.filter((item) => !item.doneAt)?.length ??
          0),
      [assignedQueueItems, memberAccessibleQueueItems]
    );

    return (
      <Box
        borderRightWidth="1px"
        borderRightColor="gray.300"
        background="white"
        transition="all 0.2s ease-in-out"
        width={isExpanded ? "200px" : menuWidth + "px"}
        minWidth={isExpanded ? "200px" : menuWidth + "px"}
        overflowX="hidden"
        height="100vh"
        position="sticky"
        top={0}
      >
        <VStack
          paddingX={0}
          paddingTop={4}
          paddingBottom={3}
          gap={6}
          height="100vh"
          align="start"
          width={isExpanded ? "200px" : "full"}
        >
          <Box width="full" paddingX="6px">
            <Button
              asChild
              className="group"
              variant="plain"
              onClick={() => setIsExpanded(!isExpanded)}
              width="full"
              minWidth="0"
              padding={2}
              paddingRight={isExpanded ? "6px" : "2px"}
              size="lg"
              _icon={{
                width: "auto",
                height: "auto",
                maxWidth: "none",
                maxHeight: "none",
              }}
              backgroundColor="white"
              _hover={{
                backgroundColor: isExpanded ? undefined : "gray.50",
              }}
            >
              <HStack fontSize="32px" fontWeight="bold" gap={0}>
                <LogoIcon width={25} height={34} />
                <Spacer />
                <Box
                  padding={isExpanded ? 2 : 0}
                  borderRadius="md"
                  backgroundColor="white"
                  _groupHover={{
                    backgroundColor: isExpanded ? "gray.50" : undefined,
                  }}
                >
                  {isExpanded ? (
                    <ChevronLeft size={16} />
                  ) : (
                    <ChevronRight size={16} />
                  )}
                </Box>
              </HStack>
            </Button>
          </Box>

          <VStack width="full" height="full" gap={0} align="start">
            <PageMenuLink
              path={projectRoutes.home.path}
              icon={TrendingUp}
              label={projectRoutes.home.title}
              project={project}
              isExpanded={isExpanded}
            />
            <PageMenuLink
              path={projectRoutes.messages.path}
              icon={MessageSquare}
              label={projectRoutes.messages.title}
              project={project}
              isExpanded={isExpanded}
            />

            <PageMenuLink
              path={projectRoutes.evaluations.path}
              icon={Shield}
              label={projectRoutes.evaluations.title}
              project={project}
              isExpanded={isExpanded}
            />

            <PageMenuLink
              path={projectRoutes.workflows.path}
              icon={PuzzleIcon}
              label={projectRoutes.workflows.title}
              project={project}
              isExpanded={isExpanded}
            />

            <PageMenuLink
              path={projectRoutes.promptConfigs.path}
              icon={Layers} // Use an appropriate icon
              label={projectRoutes.promptConfigs.title}
              project={project}
              isExpanded={isExpanded}
            />

            <PageMenuLink
              path={projectRoutes.datasets.path}
              icon={Table}
              label={projectRoutes.datasets.title}
              project={project}
              isExpanded={isExpanded}
            />
            <PageMenuLink
              path={projectRoutes.annotations.path}
              icon={Edit}
              label={projectRoutes.annotations.title}
              project={project}
              badgeNumber={totalQueueItems}
              isExpanded={isExpanded}
              iconStyle={{ marginLeft: "1px" }}
            />

            <PageMenuLink
              path={projectRoutes.experiments.path}
              icon={CheckSquare}
              label={projectRoutes.experiments.title}
              project={project}
              isExpanded={isExpanded}
            />

            <PageMenuLink
              path={projectRoutes.triggers.path}
              icon={Bell}
              label={projectRoutes.triggers.title}
              project={project}
              isExpanded={isExpanded}
            />

            {/*<SideMenuLink
              path={projectRoutes.prompts.path}
              icon={Database}
              label={projectRoutes.prompts.title}
              project={project}
            /> */}
            {(!!hasOrganizationPermission(
              OrganizationRoleGroup.ORGANIZATION_VIEW
            ) ||
              isPublicRoute) && (
              <PageMenuLink
                path={projectRoutes.settings.path}
                icon={Settings}
                label={projectRoutes.settings.title}
                project={project}
                isExpanded={isExpanded}
              />
            )}

            <Spacer />
            <SideMenuLink
              size="sm"
              href="https://docs.langwatch.ai"
              icon={
                <IconWrapper width="18px" height="18px" marginLeft="1px">
                  <BookOpen />
                </IconWrapper>
              }
              label="Documentation"
              isActive={false}
              project={project}
              isExpanded={isExpanded}
            />

            <SideMenuLink
              size="sm"
              href="https://github.com/langwatch/langwatch"
              icon={
                <IconWrapper width="18px" height="18px">
                  <GitHub />
                </IconWrapper>
              }
              label="GitHub"
              isActive={false}
              project={project}
              isExpanded={isExpanded}
            />

            <SideMenuLink
              size="sm"
              href="https://discord.gg/kT4PhDS2gH"
              icon={
                <IconWrapper width="18px" height="18px">
                  <DiscordOutlineIcon />
                </IconWrapper>
              }
              label="Community"
              isActive={false}
              project={project}
              isExpanded={isExpanded}
            />
            {(window as any)?.$crisp && project && (
              <SideMenuLink
                size="sm"
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  (window as any)?.$crisp.push(["do", "chat:show"]);
                  (window as any)?.$crisp.push(["do", "chat:toggle"]);
                }}
                icon={
                  <Box
                    position="relative"
                    color="white"
                    padding={2}
                    marginX={-2}
                    borderRadius="full"
                    minWidth={0}
                    minHeight={0}
                    backgroundColor="blue.500"
                    transition="all 0.2s ease-in-out"
                    _groupHover={{
                      transform: "scale(1.2)",
                    }}
                    _active={{
                      color: "white",
                    }}
                  >
                    <ChatBalloonIcon width={20} height={20} />
                    <Box
                      position="absolute"
                      bottom="0px"
                      right="0px"
                      width="10px"
                      height="10px"
                      borderRadius="full"
                      backgroundColor="green.500"
                      border="1px solid"
                      borderColor="white"
                    />
                  </Box>
                }
                label="Live Help"
                isActive={false}
                project={project}
                isExpanded={isExpanded}
              />
            )}
          </VStack>
        </VStack>
      </Box>
    );
  },
  (prevProps, nextProps) => {
    return prevProps.menuWidth === nextProps.menuWidth;
  }
);

const PageMenuLink = ({
  icon,
  label,
  path,
  project,
  badgeNumber,
  isExpanded,
  iconStyle,
}: {
  icon: React.ComponentType<{ size?: string | number; color?: string }>;
  label: string;
  path: string;
  project?: Project;
  badgeNumber?: number;
  isExpanded?: boolean;
  iconStyle?: React.CSSProperties;
}) => {
  const router = useRouter();
  const currentRoute = findCurrentRoute(router.pathname);
  const { isTableView } = useTableView();

  const isActive =
    !!currentRoute?.path &&
    !!path &&
    (currentRoute.path === path ||
      (path.includes("/messages") && router.pathname.includes("/messages")) ||
      (path.includes("/evaluations") &&
        router.pathname.includes("/evaluations") &&
        !router.pathname.includes("/analytics")) ||
      (path.includes("/datasets") && router.pathname.includes("/datasets")) ||
      (path.includes("/experiments") &&
        router.pathname.includes("/experiments")) ||
      (path.includes("/playground") &&
        router.pathname.includes("/playground")) ||
      (path === "/[project]" && router.pathname.includes("/analytics")) ||
      (path.includes("/annotations") &&
        router.pathname.includes("/annotations")) ||
      (path.includes("/settings") && router.pathname.includes("/settings")));

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
      isExpanded={isExpanded}
      iconStyle={iconStyle}
    />
  );
};

const SideMenuLink = ({
  size = "md",
  icon,
  label,
  href,
  project,
  isActive,
  badgeNumber,
  isExpanded,
  onClick,
  iconStyle,
}: {
  size?: "sm" | "md";
  icon:
    | React.ComponentType<{ size?: string | number; color?: string }>
    | React.ReactNode;
  label: string;
  href: string;
  project?: Project;
  isActive: boolean;
  badgeNumber?: number;
  isExpanded?: boolean;
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
  iconStyle?: React.CSSProperties;
}) => {
  const badge =
    badgeNumber && badgeNumber > 0 ? (
      <Badge
        backgroundColor="green.500"
        color="white"
        borderRadius="full"
        paddingX={1.5}
      >
        {badgeNumber}
      </Badge>
    ) : null;

  const orange400 = useColorRawValue("orange.400");
  const gray700 = useColorRawValue("gray.700");

  const IconElem = icon as any;
  const iconNode =
    typeof IconElem == "function" || IconElem.render ? (
      <IconElem
        size={24}
        color={isActive ? orange400 : gray700}
        style={{
          transform: size === "sm" ? "scale(0.8)" : "scale(0.9)",
          ...iconStyle,
        }}
      />
    ) : (
      (icon as any)
    );

  return (
    <Tooltip
      content={label}
      positioning={{ placement: "right" }}
      disabled={isExpanded}
    >
      <Link
        role="group"
        variant="plain"
        width="full"
        paddingX={6}
        paddingY={size === "sm" ? 2 : 3}
        href={href}
        aria-label={label}
        onClick={(e) => {
          trackEvent("side_menu_click", {
            project_id: project?.id,
            menu_item: label,
          });
          onClick?.(e);
        }}
        fontSize={size === "sm" ? 13 : 14}
        _hover={{
          backgroundColor: "gray.50",
        }}
        cursor="pointer"
      >
        <HStack align="center" gap={4} minHeight="21px">
          <VStack align="start" position="relative">
            {iconNode}

            {badge && (
              <Box position="absolute" bottom="-8px" right="-8px">
                {badge}
              </Box>
            )}
          </VStack>
          {isExpanded && (
            <Text color={isActive ? "orange.600" : "gray.900"} marginTop="-1px">
              {label}
            </Text>
          )}
        </HStack>
      </Link>
    </Tooltip>
  );
};
