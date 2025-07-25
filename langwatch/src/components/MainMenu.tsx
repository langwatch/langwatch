import {
  Badge,
  Box,
  Center,
  HStack,
  MenuSeparator,
  Portal,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { Project } from "@prisma/client";
import { useRouter } from "next/router";
import React from "react";
import {
  Book,
  BookOpen,
  CheckSquare,
  Edit,
  GitHub,
  Globe,
  PlayCircle,
  Settings,
  Table,
  TrendingUp,
} from "react-feather";

import {
  Activity,
  Bug,
  Lightbulb,
  LifeBuoy,
  MessageCircle,
} from "lucide-react";

import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { OrganizationRoleGroup } from "../server/api/permission";
import { api } from "../utils/api";
import { projectRoutes } from "../utils/routes";
import { trackEvent } from "../utils/tracking";

import { LuListTree } from "react-icons/lu";
import { ChatBalloonIcon } from "./icons/ChatBalloon";
import { DiscordOutlineIcon } from "./icons/DiscordOutline";
import { LogoIcon } from "./icons/LogoIcon";
import { PuzzleIcon } from "./icons/PuzzleIcon";
import { useTableView } from "./messages/HeaderButtons";
import { useColorRawValue } from "./ui/color-mode";
import { Link } from "./ui/link";
import { Menu } from "./ui/menu";
import { Tooltip } from "./ui/tooltip";

export const MENU_WIDTH = "88px";

export const MainMenu = React.memo(function MainMenu() {
  const router = useRouter();
  const { project, hasOrganizationPermission, isPublicRoute } =
    useOrganizationTeamProject();

  const pendingItemsCount = api.annotation.getPendingItemsCount.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id }
  );

  return (
    <Box
      borderRightWidth="1px"
      borderRightColor="gray.300"
      background="white"
      transition="all 0.2s ease-in-out"
      width={MENU_WIDTH}
      minWidth={MENU_WIDTH}
      overflowX="hidden"
      height="100vh"
      position="sticky"
      top={0}
    >
      <VStack
        paddingX={0}
        paddingTop={4}
        paddingBottom={0}
        gap={4}
        height="100vh"
        align="start"
        width="full"
      >
        <Center width="full" paddingX="6px">
          <LogoIcon width={25} height={34} />
        </Center>

        <VStack width="full" height="full" gap={0} align="start">
          <PageMenuLink
            path={projectRoutes.home.path}
            icon={TrendingUp}
            label={projectRoutes.home.title}
            project={project}
            isActive={
              router.pathname == "/[project]" ||
              router.pathname.includes("/analytics")
            }
          />
          <PageMenuLink
            path={projectRoutes.messages.path}
            icon={LuListTree}
            label={projectRoutes.messages.title}
            project={project}
            isActive={router.pathname.includes("/messages")}
          />
          <PageMenuLink
            path={projectRoutes.simulations.path}
            icon={PlayCircle}
            label={projectRoutes.simulations.title}
            project={project}
            isActive={router.pathname.includes("/simulations")}
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
          />

          <PageMenuLink
            path={projectRoutes.workflows.path}
            icon={PuzzleIcon}
            label={projectRoutes.workflows.title}
            project={project}
            isActive={router.pathname.includes("/workflows")}
          />

          <PageMenuLink
            path={projectRoutes.promptConfigs.path}
            icon={Book}
            label={projectRoutes.promptConfigs.title}
            project={project}
            isActive={router.pathname.includes("/prompts")}
          />

          <PageMenuLink
            path={projectRoutes.datasets.path}
            icon={Table}
            label={projectRoutes.datasets.title}
            project={project}
            isActive={router.pathname.includes("/datasets")}
          />
          <PageMenuLink
            path={projectRoutes.annotations.path}
            icon={Edit}
            label={projectRoutes.annotations.title}
            project={project}
            badgeNumber={pendingItemsCount.data}
            iconStyle={{ marginLeft: "1px" }}
            isActive={router.pathname.includes("/annotations")}
          />

          {(!!hasOrganizationPermission(
            OrganizationRoleGroup.ORGANIZATION_VIEW
          ) ||
            isPublicRoute) && (
            <PageMenuLink
              path={projectRoutes.settings.path}
              icon={Settings}
              label={projectRoutes.settings.title}
              project={project}
              isActive={router.pathname.includes("/settings")}
            />
          )}

          <Spacer />

          <VStack
            width="full"
            align="center"
            gap={2}
            padding={2}
            paddingBottom={4}
          >
            <HStack
              width="full"
              align="center"
              gap={1}
              cursor="pointer"
              onClick={(e) => {
                e.preventDefault();
                (window as any)?.$crisp.push(["do", "chat:show"]);
                (window as any)?.$crisp.push(["do", "chat:toggle"]);
              }}
            >
              <MessageCircle size={16} />
              <Text fontSize="xs" color="gray.600" textAlign="center">
                Chat
              </Text>
            </HStack>

            <Menu.Root positioning={{ placement: "right-start" }}>
              <Menu.Trigger asChild>
                <HStack width="full" align="center" gap={0}>
                  <LifeBuoy size={16} />
                  <Text
                    fontSize="xs"
                    color="gray.600"
                    textAlign="center"
                    width="full"
                  >
                    Support
                  </Text>
                </HStack>
              </Menu.Trigger>

              <Portal>
                <Menu.Content>
                  <Menu.Item value="github">
                    <Link
                      isExternal
                      href="https://github.com/orgs/langwatch/discussions/categories/support"
                    >
                      <GitHub /> GitHub Support
                    </Link>
                  </Menu.Item>
                  <Menu.Item value="discord">
                    <Link isExternal href="https://discord.gg/kT4PhDS2gH">
                      <DiscordOutlineIcon /> Discord
                    </Link>
                  </Menu.Item>
                  <MenuSeparator />
                  <Menu.Item value="documentation">
                    <Link isExternal href="https://docs.langwatch.ai">
                      <BookOpen /> Documentation
                    </Link>
                  </Menu.Item>

                  <Menu.Item value="status">
                    <Link isExternal href="https://status.langwatch.ai/">
                      <Activity /> Status Page
                    </Link>
                  </Menu.Item>

                  <MenuSeparator />

                  <Menu.Item value="feature-requests">
                    <Link
                      isExternal
                      href="https://github.com/orgs/langwatch/discussions/categories/ideas"
                    >
                      <Lightbulb /> Feature Request
                    </Link>
                  </Menu.Item>
                  <Menu.Item value="bug-reports">
                    <Link
                      isExternal
                      href="https://github.com/langwatch/langwatch/issues"
                    >
                      <Bug /> Report a Bug
                    </Link>
                  </Menu.Item>
                </Menu.Content>
              </Portal>
            </Menu.Root>
          </VStack>
        </VStack>
      </VStack>
    </Box>
  );
});

const PageMenuLink = ({
  icon,
  label,
  path,
  project,
  badgeNumber,
  iconStyle,
  isActive,
}: {
  icon: React.ComponentType<{ size?: string | number; color?: string }>;
  label: string;
  path: string;
  project?: Project;
  badgeNumber?: number;
  iconStyle?: React.CSSProperties;
  isActive: boolean;
}) => {
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
      positioning={{
        placement: "top",
      }}
      disabled={size !== "sm"}
      openDelay={0}
    >
      <Link
        variant="plain"
        width="full"
        paddingX={4}
        paddingY={3}
        href={href}
        aria-label={label}
        onClick={(e) => {
          trackEvent("side_menu_click", {
            project_id: project?.id,
            menu_item: label,
          });
          onClick?.(e);
        }}
        fontSize={11}
        _hover={{
          backgroundColor: "gray.50",
        }}
        {...(size === "sm" && {
          paddingX: 0,
          paddingY: 2,
          fontSize: 10,
        })}
      >
        <VStack width="full" align="center" gap={1} minHeight="21px">
          <VStack align="start" position="relative">
            {iconNode}

            {badge && (
              <Box position="absolute" bottom="-8px" right="-8px">
                {badge}
              </Box>
            )}
          </VStack>
          {size === "md" && (
            <Text color={isActive ? "orange.600" : "gray.600"}>{label}</Text>
          )}
        </VStack>
      </Link>
    </Tooltip>
  );
};
