import { Link } from "@chakra-ui/next-js";
import {
  Alert,
  AlertIcon,
  Avatar,
  Badge,
  Box,
  Button,
  Center,
  HStack,
  Hide,
  Input,
  InputGroup,
  InputLeftElement,
  Menu,
  MenuButton,
  MenuGroup,
  MenuItem,
  MenuList,
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  Portal,
  Spacer,
  Text,
  Tooltip,
  VStack,
  useTheme,
  type BoxProps,
} from "@chakra-ui/react";
import { type Organization, type Project, type Team } from "@prisma/client";
import { signIn, signOut } from "next-auth/react";
import ErrorPage from "next/error";
import Head from "next/head";
import { useRouter } from "next/router";
import numeral from "numeral";
import React, { useMemo, useState } from "react";
import {
  Bell,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Edit,
  Lock,
  MessageSquare,
  Play,
  Plus,
  Search,
  Settings,
  Shield,
  Table,
  TrendingUp,
} from "react-feather";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { useRequiredSession } from "../hooks/useRequiredSession";
import { dependencies } from "../injection/dependencies.client";
import { OrganizationRoleGroup } from "../server/api/permission";
import type { FullyLoadedOrganization } from "../server/api/routers/organization";
import { api } from "../utils/api";
import { findCurrentRoute, projectRoutes, type Route } from "../utils/routes";
import { trackEvent } from "../utils/tracking";
import { CurrentDrawer } from "./CurrentDrawer";
import { IntegrationChecks, useIntegrationChecks } from "./IntegrationChecks";
import { LoadingScreen } from "./LoadingScreen";
import { ProjectTechStackIcon } from "./TechStack";
import { ChecklistIcon } from "./icons/Checklist";
import { GitHub } from "react-feather";
import { LogoIcon } from "./icons/LogoIcon";
import { PuzzleIcon } from "./icons/PuzzleIcon";
import { useTableView } from "./messages/HeaderButtons";
import { IconWrapper } from "./IconWrapper";
import { usePublicEnv } from "../hooks/usePublicEnv";
import { DiscordOutlineIcon } from "./icons/DiscordOutline";
import { ChatBalloonIcon } from "./icons/ChatBalloon";
import { HoverableBigText } from "./HoverableBigText";
import { useAnnotationQueues } from "~/hooks/useAnnotationQueues";
import { useDebounceValue } from "usehooks-ts";

const Breadcrumbs = ({ currentRoute }: { currentRoute: Route | undefined }) => {
  const { project } = useOrganizationTeamProject();

  return (
    currentRoute && (
      <HStack gap={2} fontSize={13} color="gray.500">
        <Link href="/">Dashboard</Link>
        {currentRoute.parent && (
          <>
            <ChevronRight width="12" style={{ minWidth: "12px" }} />
            <Link
              href={projectRoutes[currentRoute.parent].path.replace(
                "[project]",
                project?.slug ?? ""
              )}
            >
              {projectRoutes[currentRoute.parent].title}
            </Link>
          </>
        )}
        <ChevronRight width="12" style={{ minWidth: "12px" }} />
        <HoverableBigText noOfLines={1} expandable={false}>
          {currentRoute.title}
        </HoverableBigText>
      </HStack>
    )
  );
};

const PageMenuLink = ({
  icon,
  label,
  path,
  project,
  badgeNumber,
  isHovered,
}: {
  icon: React.ComponentType<{ size?: string | number; color?: string }>;
  label: string;
  path: string;
  project?: Project;
  badgeNumber?: number;
  isHovered?: boolean;
}) => {
  const router = useRouter();
  const currentRoute = findCurrentRoute(router.pathname);
  const { isTableView } = useTableView();

  const isActive =
    currentRoute?.path === path ||
    (path.includes("/messages") && router.pathname.includes("/messages")) ||
    (path.includes("/evaluations") &&
      router.pathname.includes("/evaluations")) ||
    (path.includes("/datasets") && router.pathname.includes("/datasets")) ||
    (path.includes("/experiments") &&
      router.pathname.includes("/experiments")) ||
    (path.includes("/playground") && router.pathname.includes("/playground")) ||
    (path === "/[project]" && router.pathname.includes("/analytics")) ||
    (path.includes("/annotations") &&
      router.pathname.includes("/annotations")) ||
    (path.includes("/settings") && router.pathname.includes("/settings"));

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
      isHovered={isHovered}
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
  isHovered,
  onClick,
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
  isHovered?: boolean;
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
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

  const theme = useTheme();
  const orange400 = theme.colors.orange["400"];
  const gray600 = theme.colors.gray["600"];

  const IconElem = icon as any;
  const iconNode =
    typeof IconElem == "function" || IconElem.render ? (
      <IconElem
        size={size === "sm" ? 18 : 24}
        color={isActive ? orange400 : gray600}
      />
    ) : (
      (icon as any)
    );

  return (
    <Link
      variant="unstyled"
      width="full"
      paddingX={4}
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
      fontSize={size === "sm" ? 10 : 11}
      _hover={{
        backgroundColor: "gray.50",
      }}
    >
      <VStack align="center" spacing={1} minHeight="21px">
        <VStack align="start" position="relative">
          {iconNode}

          {badge && (
            <Box position="absolute" bottom="-8px" right="-8px">
              {badge}
            </Box>
          )}
        </VStack>
        {/* {isHovered && ( */}
        <Text color={isActive ? "orange.600" : "gray.600"}>{label}</Text>
        {/* )} */}
      </VStack>
    </Link>
  );
};

export const ProjectSelector = React.memo(function ProjectSelector({
  organizations,
  project,
}: {
  organizations: FullyLoadedOrganization[];
  project: Project;
}) {
  const router = useRouter();
  const currentRoute = findCurrentRoute(router.pathname);
  const { data: session } = useRequiredSession();

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
    }))
  );

  const [isOpen, setIsOpen] = useState(false);

  return (
    <Menu
      isOpen={isOpen}
      onOpen={() => setIsOpen(true)}
      onClose={() => setIsOpen(false)}
    >
      <MenuButton
        as={Button}
        variant="outline"
        borderColor="gray.300"
        fontSize={13}
        paddingX={4}
        paddingY={1}
        height="auto"
        fontWeight="normal"
        minWidth="fit-content"
      >
        <HStack gap={2}>
          <ProjectTechStackIcon project={project} />
          <Box>{project.name}</Box>
          <Box>
            <ChevronDown width={14} />
          </Box>
        </HStack>
      </MenuButton>
      <Portal>
        <Box zIndex="popover" padding={0}>
          {isOpen && (
            <MenuList zIndex="popover">
              <>
                {projectGroups
                  .filter((projectGroup) =>
                    projectGroup.team.members.some(
                      (member) => member.userId === session?.user.id
                    )
                  )
                  .map((projectGroup) => (
                    <MenuGroup
                      key={projectGroup.team.id}
                      title={
                        projectGroup.organization.name +
                        (projectGroup.team.name !==
                        projectGroup.organization.name
                          ? " - " + projectGroup.team.name
                          : "")
                      }
                    >
                      {projectGroup.projects.map((project) => (
                        <Link
                          key={project.id}
                          href={
                            currentRoute?.path.includes("[project]")
                              ? currentRoute.path
                                  .replace("[project]", project.slug)
                                  .replace(/\[.*?\]/g, "")
                                  .replace(/\/\/+/g, "/")
                              : `/${project.slug}?return_to=${window.location.pathname}`
                          }
                          _hover={{
                            textDecoration: "none",
                          }}
                        >
                          <MenuItem
                            icon={
                              <HStack width="26px" justify="center">
                                <ProjectTechStackIcon project={project} />
                              </HStack>
                            }
                            fontSize="14px"
                          >
                            {project.name}
                          </MenuItem>
                        </Link>
                      ))}
                      <AddProjectButton
                        team={projectGroup.team}
                        organization={projectGroup.organization}
                      />
                    </MenuGroup>
                  ))}
              </>
            </MenuList>
          )}
        </Box>
      </Portal>
    </Menu>
  );
});

export const AddProjectButton = ({
  team,
  organization,
}: {
  team: Team;
  organization: Organization;
}) => {
  const { project } = useOrganizationTeamProject();
  const usage = api.limits.getUsage.useQuery(
    { organizationId: organization.id },
    {
      enabled: !!organization,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    }
  );

  return !usage.data ||
    usage.data.projectsCount < usage.data.activePlan.maxProjects ? (
    <Link
      href={`/onboarding/${team.slug}/project`}
      _hover={{
        textDecoration: "none",
      }}
    >
      <MenuItem icon={<Plus />} fontSize="14px">
        New Project
      </MenuItem>
    </Link>
  ) : (
    <Tooltip label="You reached the limit of max new projects, click to upgrade your plan to add more projects">
      <Link
        href={`/settings/subscription`}
        _hover={{
          textDecoration: "none",
        }}
        onClick={() => {
          trackEvent("subscription_hook_click", {
            project_id: project?.id,
            hook: "new_project",
          });
        }}
      >
        <MenuItem
          icon={<Lock />}
          fontSize="14px"
          color="gray.400"
          _hover={{
            backgroundColor: "transparent",
          }}
        >
          New Project
        </MenuItem>
      </Link>
    </Tooltip>
  );
};

export const DashboardLayout = ({
  children,
  publicPage = false,
  ...props
}: { publicPage?: boolean } & BoxProps) => {
  const router = useRouter();
  const theme = useTheme();
  const gray400 = theme.colors.gray["400"];

  const { data: session } = useRequiredSession({ required: !publicPage });

  const {
    isLoading,
    organization,
    organizations,
    team,
    project,
    hasOrganizationPermission,
    isPublicRoute,
  } = useOrganizationTeamProject();
  const usage = api.limits.getUsage.useQuery(
    { organizationId: organization?.id ?? "" },
    {
      enabled: !!organization,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    }
  );
  const publicEnv = usePublicEnv();

  const [query, setQuery] = useState(router.query.query as string);

  const { assignedQueueItems, memberAccessibleQueueItems } =
    useAnnotationQueues();

  const totalQueueItems = useMemo(
    () =>
      (assignedQueueItems?.filter((item) => !item.doneAt)?.length ?? 0) +
      (memberAccessibleQueueItems?.filter((item) => !item.doneAt)?.length ?? 0),
    [assignedQueueItems, memberAccessibleQueueItems]
  );

  const integrationChecks = useIntegrationChecks();

  const integrationsLeft = useMemo(() => {
    return Object.entries(integrationChecks.data ?? {}).filter(
      ([key, value]) => key !== "integrated" && !value
    ).length;
  }, [integrationChecks.data]);

  const [isHovered, setIsHovered] = useDebounceValue(false, 200, {
    leading: true,
  });

  if (typeof router.query.project === "string" && !isLoading && !project) {
    return <ErrorPage statusCode={404} />;
  }

  if (
    !publicPage &&
    (!session ||
      isLoading ||
      !organization ||
      !organizations ||
      !team ||
      !project)
  ) {
    return <LoadingScreen />;
  }

  const user = session?.user;
  const currentRoute = findCurrentRoute(router.pathname);
  const menuWidth = 88;

  return (
    <HStack width="full" minHeight="100vh" alignItems={"stretch"} spacing={0}>
      <Head>
        <title>
          LangWatch{project ? ` - ${project.name}` : ""}
          {currentRoute && currentRoute.title != "Home"
            ? ` - ${currentRoute?.title}`
            : ""}
        </title>
      </Head>
      {!isHovered && (
        <Box
          position="fixed"
          zIndex={4}
          onMouseEnter={() => setIsHovered(true)}
          width="20px"
          top={0}
          left={menuWidth + 5 + "px"}
          height="100vh"
        ></Box>
      )}
      <Box
        borderRightWidth="1px"
        borderRightColor="gray.300"
        background="white"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        transition="all 0.2s ease-in-out"
        width={menuWidth + "px"}
        minWidth={menuWidth + "px"}
        overflowX="hidden"
      >
        <VStack
          paddingX={0}
          paddingTop={8}
          paddingBottom={3}
          spacing={6}
          position="sticky"
          top={0}
          height="100vh"
          align="start"
          width="full"
        >
          <Box fontSize={32} fontWeight="bold" width="full">
            <Center>
              <LogoIcon width={25} height={34} />
            </Center>
          </Box>

          <VStack
            width="full"
            height="full"
            spacing={0}
            paddingTop={0}
            align="start"
          >
            <PageMenuLink
              path={projectRoutes.home.path}
              icon={TrendingUp}
              label={projectRoutes.home.title}
              project={project}
              isHovered={isHovered}
            />
            <PageMenuLink
              path={projectRoutes.messages.path}
              icon={MessageSquare}
              label={projectRoutes.messages.title}
              project={project}
              isHovered={isHovered}
            />
            {/* <SideMenuLink
              path={projectRoutes.analytics.path}
              icon={TrendingUp}
              label={projectRoutes.analytics.title}
              project={project}
            />*/}
            <PageMenuLink
              path={projectRoutes.evaluations.path}
              icon={Shield}
              label={projectRoutes.evaluations.title}
              project={project}
              isHovered={isHovered}
            />

            <PageMenuLink
              path={projectRoutes.workflows.path}
              icon={PuzzleIcon}
              label={projectRoutes.workflows.title}
              project={project}
              isHovered={isHovered}
            />
            {/* <SideMenuLink
              path={projectRoutes.playground.path}
              icon={ImageIcon}
              label={projectRoutes.playground.title}
              project={project}
            /> */}

            <PageMenuLink
              path={projectRoutes.datasets.path}
              icon={Table}
              label={projectRoutes.datasets.title}
              project={project}
              isHovered={isHovered}
            />
            <PageMenuLink
              path={projectRoutes.annotations.path}
              icon={Edit}
              label={projectRoutes.annotations.title}
              project={project}
              badgeNumber={totalQueueItems}
              isHovered={isHovered}
            />
            <PageMenuLink
              path={projectRoutes.triggers.path}
              icon={Bell}
              label={projectRoutes.triggers.title}
              project={project}
              isHovered={isHovered}
            />
            <PageMenuLink
              path={projectRoutes.experiments.path}
              icon={Play}
              label={projectRoutes.experiments.title}
              project={project}
              isHovered={isHovered}
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
                isHovered={isHovered}
              />
            )}

            <Spacer />
            {/* <SideMenuLink
              size="sm"
              href="https://docs.langwatch.ai"
              icon={BookOpen}
              label="Documentation"
              isActive={false}
              project={project}
              isHovered={isHovered}
            />

            <SideMenuLink
              size="sm"
              href="https://github.com/langwatch/langwatch"
              icon={
                <IconWrapper width="20px" height="20px">
                  <GitHub />
                </IconWrapper>
              }
              label="GitHub"
              isActive={false}
              project={project}
              isHovered={isHovered}
            />

            <SideMenuLink
              size="sm"
              href="https://discord.gg/kT4PhDS2gH"
              icon={
                <IconWrapper width="20px" height="20px">
                  <DiscordOutlineIcon />
                </IconWrapper>
              }
              label="Community"
              isActive={false}
              project={project}
              isHovered={isHovered}
            /> */}
            {(window as any)?.$crisp && (
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
                    _hover={{
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
                isHovered={isHovered}
              />
            )}
          </VStack>
        </VStack>
      </Box>
      <VStack
        width="full"
        maxWidth="calc(100vw - 90px)"
        spacing={0}
        background="gray.100"
        {...props}
      >
        {usage.data &&
          usage.data.currentMonthMessagesCount >=
            usage.data.activePlan.maxMessagesPerMonth && (
            <Alert
              status="warning"
              width="full"
              borderBottom="1px solid"
              borderBottomColor="yellow.300"
            >
              <AlertIcon />
              <Text>
                You reached the limit of{" "}
                {numeral(usage.data.activePlan.maxMessagesPerMonth).format()}{" "}
                messages for this month, new messages will not be processed.{" "}
                <Link
                  href="/settings/subscription"
                  textDecoration="underline"
                  _hover={{
                    textDecoration: "none",
                  }}
                  onClick={() => {
                    trackEvent("subscription_hook_click", {
                      project_id: project?.id,
                      hook: "new_messages_limit_reached",
                    });
                  }}
                >
                  Click here
                </Link>{" "}
                to upgrade your plan.
              </Text>
            </Alert>
          )}
        {usage.data &&
          usage.data.currentMonthCost > usage.data.maxMonthlyUsageLimit && (
            <Alert
              status="warning"
              width="full"
              borderBottom="1px solid"
              borderBottomColor="yellow.300"
            >
              <AlertIcon />
              <Text>
                You reached the limit of{" "}
                {numeral(usage.data.maxMonthlyUsageLimit).format("$0.00")} usage
                cost for this month, evaluations and guardrails will not be
                processed.{" "}
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
            </Alert>
          )}
        <HStack
          position="relative"
          zIndex={3}
          width="full"
          padding={4}
          background="white"
          borderBottomWidth="1px"
          borderBottomColor="gray.300"
          justifyContent="space-between"
        >
          <HStack gap={6} flex={1.5}>
            {organizations && project && (
              <ProjectSelector
                organizations={organizations}
                project={project}
              />
            )}
            {!project && (
              <Text paddingLeft={2}>
                <Link href="/auth/signin" color="orange.600" fontWeight="600">
                  Sign in
                </Link>{" "}
                to LangWatch to monitor your projects
              </Text>
            )}
            <Hide below="lg">
              <Breadcrumbs currentRoute={currentRoute} />
            </Hide>
          </HStack>
          {project && (
            <form
              action={`${project.slug}/messages`}
              method="GET"
              style={{ flex: 2, maxWidth: "600px" }}
              onSubmit={(e) => {
                e.preventDefault();
                if (
                  router.query.view === "list" ||
                  router.query.view === "table"
                ) {
                  void router.replace({ query: { ...router.query, query } });
                } else {
                  void router.push(
                    `/${project.slug}/messages?query=${encodeURIComponent(
                      query
                    )}`
                  );
                }
              }}
            >
              <InputGroup borderColor="gray.300">
                <InputLeftElement
                  paddingY={1.5}
                  height="auto"
                  pointerEvents="none"
                >
                  <Search color={gray400} width={16} />
                </InputLeftElement>
                <Input
                  name="query"
                  type="search"
                  placeholder="Search"
                  _placeholder={{ color: "gray.800" }}
                  fontSize={14}
                  paddingY={1.5}
                  height="auto"
                  value={query ?? router.query.query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </InputGroup>
            </form>
          )}
          <HStack gap={6} flex={1}>
            <Spacer />
            <HStack spacing={4}>
              {integrationsLeft ? (
                <Popover placement="bottom-end">
                  <PopoverTrigger>
                    <Button position="relative" variant="ghost">
                      <ChecklistIcon />
                      <Badge
                        position="absolute"
                        bottom="2px"
                        right="2px"
                        size="sm"
                        color="white"
                        backgroundColor="green.500"
                        borderRadius="full"
                      >
                        {integrationsLeft}
                      </Badge>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent>
                    <PopoverBody padding={4}>
                      <IntegrationChecks />
                    </PopoverBody>
                  </PopoverContent>
                </Popover>
              ) : (
                <Box width={["auto", "auto", "auto", "55px"]} />
              )}
              <Menu>
                <MenuButton
                  as={Button}
                  variant="unstyled"
                  {...(publicPage
                    ? { onClick: () => void signIn("auth0") }
                    : {})}
                >
                  <Avatar
                    name={user?.name ?? undefined}
                    backgroundColor={"orange.400"}
                    color="white"
                    size="sm"
                  />
                </MenuButton>
                {session && (
                  <Portal>
                    <MenuList zIndex="popover">
                      {dependencies.ExtraMenuItems && (
                        <dependencies.ExtraMenuItems />
                      )}
                      <MenuGroup
                        title={`${session.user.name} (${session.user.email})`}
                      >
                        <MenuItem
                          onClick={() =>
                            void signOut({
                              callbackUrl: window.location.origin,
                            })
                          }
                        >
                          Logout
                        </MenuItem>
                      </MenuGroup>
                    </MenuList>
                  </Portal>
                )}
              </Menu>
            </HStack>
          </HStack>
        </HStack>
        {publicEnv.data?.DEMO_PROJECT_SLUG &&
          publicEnv.data.DEMO_PROJECT_SLUG === router.query.project && (
            <HStack width={"full"} backgroundColor={"orange.400"} padding={1}>
              <Spacer />
              <Text fontSize={"sm"}>
                Viewing Demo Project - Go back to yours{" "}
                <Link href={"/"} textDecoration={"underline"}>
                  here
                </Link>
              </Text>
              <Spacer />
            </HStack>
          )}
        <CurrentDrawer />
        {children}
      </VStack>
    </HStack>
  );
};
