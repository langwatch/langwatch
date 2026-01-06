import {
  Alert,
  Avatar,
  Box,
  Button,
  HStack,
  Input,
  Portal,
  Spacer,
  type StackProps,
  Text,
  useBreakpointValue,
  VStack,
} from "@chakra-ui/react";
import type { Organization, Project, Team } from "@prisma/client";
import { ChevronDown, ChevronRight, Lock, Plus, Search } from "lucide-react";
import ErrorPage from "next/error";
import Head from "next/head";
import { useRouter } from "next/router";
import { signIn, signOut } from "next-auth/react";
import numeral from "numeral";
import React, { useState } from "react";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { usePublicEnv } from "../hooks/usePublicEnv";
import { useRequiredSession } from "../hooks/useRequiredSession";
import { dependencies } from "../injection/dependencies.client";
import type { FullyLoadedOrganization } from "../server/api/routers/organization";
import { api } from "../utils/api";
import { findCurrentRoute, projectRoutes, type Route } from "../utils/routes";
import { trackEvent } from "../utils/tracking";
import { CurrentDrawer } from "./CurrentDrawer";
import { FullLogo } from "./icons/FullLogo";
import { LogoIcon } from "./icons/LogoIcon";
import { LoadingScreen } from "./LoadingScreen";
import { MainMenu, MENU_WIDTH_COMPACT, MENU_WIDTH_EXPANDED } from "./MainMenu";
import { RandomColorAvatar } from "./RandomColorAvatar";
import { useColorRawValue } from "./ui/color-mode";
import { InputGroup } from "./ui/input-group";
import { Link } from "./ui/link";
import { Menu } from "./ui/menu";
import { Tooltip } from "./ui/tooltip";

const Breadcrumbs = ({ currentRoute }: { currentRoute: Route | undefined }) => {
  const { project } = useOrganizationTeamProject();

  if (!currentRoute) return null;

  return (
    <HStack gap={2} fontSize="13px" color="gray.500" alignItems="center">
      <ChevronRight width="12" style={{ minWidth: "12px" }} />
      <Link href={`/${project?.slug ?? ""}`}>Dashboard</Link>
      {currentRoute.parent && (
        <>
          <ChevronRight width="12" style={{ minWidth: "12px" }} />
          <Link
            href={projectRoutes[currentRoute.parent].path.replace(
              "[project]",
              project?.slug ?? "",
            )}
          >
            {projectRoutes[currentRoute.parent].title}
          </Link>
        </>
      )}
      {currentRoute.title !== "Home" && (
        <>
          <ChevronRight width="12" style={{ minWidth: "12px" }} />
          <Text color="gray.500" whiteSpace="nowrap">
            {currentRoute.title}
          </Text>
        </>
      )}
    </HStack>
  );
};

const ProjectAvatar = ({
  name,
  size = "2xs",
}: {
  name: string;
  size?: "2xs" | "xs" | "sm";
}) => {
  return (
    <RandomColorAvatar
      size={size}
      name={name.slice(0, 1)}
      width={size === "2xs" ? "20px" : undefined}
      height={size === "2xs" ? "20px" : undefined}
    />
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
  const [open, setOpen] = useState(false);

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
    })),
  );

  return (
    <Menu.Root open={open} onOpenChange={({ open }) => setOpen(open)}>
      <Menu.Trigger asChild>
        <Button
          variant="ghost"
          fontSize="13px"
          paddingX={2}
          paddingY={1}
          height="auto"
          fontWeight="normal"
          minWidth="fit-content"
          color="gray.700"
          _hover={{
            backgroundColor: "gray.200",
          }}
        >
          <HStack gap={2}>
            <ProjectAvatar name={project.name} />
            <Text>{project.name}</Text>
            <ChevronDown size={14} />
          </HStack>
        </Button>
      </Menu.Trigger>
      <Portal>
        <Box zIndex="popover" padding={0}>
          {open && (
            <Menu.Content zIndex="popover">
              <>
                {projectGroups
                  .filter((projectGroup) =>
                    projectGroup.team.members.some(
                      (member) => member.userId === session?.user.id,
                    ),
                  )
                  .map((projectGroup) => (
                    <Menu.ItemGroup
                      key={projectGroup.team.id}
                      title={
                        projectGroup.organization.name +
                        (projectGroup.team.name !==
                        projectGroup.organization.name
                          ? " - " + projectGroup.team.name
                          : "")
                      }
                    >
                      {projectGroup.projects.map((project_) => (
                        <Menu.Item
                          key={project_.id}
                          value={project_.id}
                          fontSize="14px"
                          asChild
                        >
                          <Link
                            key={project_.id}
                            href={(() => {
                              const currentPath = window.location.pathname;
                              const hasProjectInRoute =
                                currentRoute?.path.includes("[project]");
                              const hasProjectInPath = currentPath.includes(
                                project.slug,
                              );

                              if (hasProjectInRoute) {
                                return currentRoute?.path
                                  .replace("[project]", project_.slug)
                                  .replace(/\[.*?\]/g, "")
                                  .replace(/\/\/+/g, "/");
                              } else if (hasProjectInPath) {
                                return currentPath.replace(
                                  project.slug,
                                  project_.slug,
                                );
                              } else {
                                return `/${
                                  project_.slug
                                }?return_to=${encodeURIComponent(currentPath)}`;
                              }
                            })()}
                            _hover={{
                              textDecoration: "none",
                            }}
                          >
                            <HStack gap={2}>
                              <ProjectAvatar name={project_.name} />
                              <Text>{project_.name}</Text>
                            </HStack>
                          </Link>
                        </Menu.Item>
                      ))}
                      <AddProjectButton
                        team={projectGroup.team}
                        organization={projectGroup.organization}
                      />
                    </Menu.ItemGroup>
                  ))}
              </>
            </Menu.Content>
          )}
        </Box>
      </Portal>
    </Menu.Root>
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
    },
  );

  return !usage.data ||
    usage.data.projectsCount < usage.data.activePlan.maxProjects ? (
    <Link
      href={`/onboarding/${team.slug}/project`}
      _hover={{
        textDecoration: "none",
      }}
    >
      <Menu.Item value={`new-project-${team.slug}`} fontSize="14px">
        <Plus />
        New Project
      </Menu.Item>
    </Link>
  ) : (
    <Tooltip content="You reached the limit of max new projects, click to upgrade your plan to add more projects">
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
        <Menu.Item
          value={`new-project-${team.slug}`}
          fontSize="14px"
          color="gray.400"
          _hover={{
            backgroundColor: "transparent",
          }}
        >
          <Lock />
          New Project
        </Menu.Item>
      </Link>
    </Tooltip>
  );
};

export type DashboardLayoutProps = {
  publicPage?: boolean;
  compactMenu?: boolean;
} & StackProps;

export const DashboardLayout = ({
  children,
  publicPage = false,
  compactMenu: compactMenuProp = false,
  ...props
}: DashboardLayoutProps) => {
  const isSmallScreen = useBreakpointValue({ base: true, lg: false });
  const compactMenu = isSmallScreen ? true : compactMenuProp;
  const router = useRouter();
  const gray400 = useColorRawValue("gray.400");

  const { data: session } = useRequiredSession({ required: !publicPage });

  const { isLoading, organization, organizations, team, project } =
    useOrganizationTeamProject();
  const usage = api.limits.getUsage.useQuery(
    { organizationId: organization?.id ?? "" },
    {
      enabled: !!organization,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    },
  );
  const publicEnv = usePublicEnv();

  const [query, setQuery] = useState(router.query.query as string);

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
  const isDemoProject = publicEnv.data?.DEMO_PROJECT_SLUG === project?.slug;
  const userIsPartOfTeam =
    publicPage ||
    isDemoProject ||
    team?.members.some((member) => member.userId === user?.id);

  const menuWidth = compactMenu ? MENU_WIDTH_COMPACT : MENU_WIDTH_EXPANDED;

  return (
    <Box
      width="full"
      minHeight="100vh"
      background="gray.100"
      overflowX={["auto", "auto", "clip"]}
    >
      <Head>
        <title>
          LangWatch{project ? ` - ${project.name}` : ""}
          {currentRoute && currentRoute.title != "Home"
            ? ` - ${currentRoute?.title}`
            : ""}
        </title>
      </Head>

      {/* Header bar - spans full width with gray background */}
      <HStack
        width="full"
        paddingX={4}
        paddingY={3}
        background="gray.100"
        justifyContent="space-between"
        gap={4}
      >
        {/* Left side: Logo + Project + Breadcrumbs */}
        <HStack gap={compactMenu ? 3 : 0} flex={1} alignItems="center">
          {/* Logo container - fixed width for expanded menu, natural for compact */}
          {compactMenu ? (
            <Link href="/" display="flex" alignItems="center">
              <LogoIcon width={25 * 0.7} height={32 * 0.7} />
            </Link>
          ) : (
            <Box
              width={MENU_WIDTH_EXPANDED}
              minWidth={MENU_WIDTH_EXPANDED}
              paddingLeft={2}
              display="flex"
              alignItems="center"
            >
              <Link href="/">
                <FullLogo width={155 * 0.7} height={38 * 0.7} />
              </Link>
            </Box>
          )}
          {organizations && project ? (
            <HStack gap={0} alignItems="center">
              <ProjectSelector
                organizations={organizations}
                project={project}
              />
              <Box display={["none", "none", "flex"]}>
                <Breadcrumbs currentRoute={currentRoute} />
              </Box>
            </HStack>
          ) : (
            <Text paddingLeft={2}>
              <Link href="/auth/signin" color="orange.600" fontWeight="600">
                Sign in
              </Link>{" "}
              to LangWatch to monitor your projects
            </Text>
          )}
        </HStack>

        {/* Right side: Search, integrations, user */}
        <HStack gap={2} justifyContent="flex-end">
          {/* Search bar - compact, expands on focus */}
          {project && (
            <form
              action={`${project.slug}/messages`}
              method="GET"
              onSubmit={(e: React.FormEvent) => {
                e.preventDefault();
                if (
                  router.query.view === "list" ||
                  router.query.view === "table"
                ) {
                  void router.replace({ query: { ...router.query, query } });
                } else {
                  void router.push(
                    `/${project.slug}/messages?query=${encodeURIComponent(
                      query,
                    )}`,
                  );
                }
              }}
            >
              <InputGroup startElement={<Search color={gray400} size={14} />}>
                <Input
                  name="query"
                  type="search"
                  placeholder="Search"
                  _placeholder={{ color: "gray.500" }}
                  fontSize="13px"
                  paddingY={1}
                  paddingLeft={8}
                  paddingRight={3}
                  width="120px"
                  height="32px"
                  backgroundColor="gray.200"
                  border="none"
                  borderRadius="full"
                  transition="all 0.2s ease-in-out"
                  _focus={{
                    width: "240px",
                    backgroundColor: "white",
                    boxShadow: "sm",
                    outline: "none",
                  }}
                  value={query ?? router.query.query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </InputGroup>
            </form>
          )}

          <Menu.Root>
            <Menu.Trigger asChild>
              <Button
                variant="ghost"
                size="xs"
                padding={0}
                minWidth="auto"
                height="auto"
                borderRadius="full"
                {...(publicPage ? { onClick: () => void signIn("auth0") } : {})}
              >
                <Avatar.Root
                  size="xs"
                  backgroundColor="orange.400"
                  color="white"
                  width="28px"
                  height="28px"
                >
                  <Avatar.Fallback
                    name={user?.name ?? undefined}
                    fontSize="11px"
                  />
                </Avatar.Root>
              </Button>
            </Menu.Trigger>
            {session && (
              <Portal>
                <Menu.Content zIndex="popover">
                  {dependencies.ExtraMenuItems && (
                    <dependencies.ExtraMenuItems />
                  )}
                  <Menu.ItemGroup
                    title={`${session.user.name} (${session.user.email})`}
                  >
                    <Menu.Item value="setup" asChild>
                      <Link href={`/${project?.slug}/setup`}>
                        API Key & Setup
                      </Link>
                    </Menu.Item>
                    <Menu.Item value="settings" asChild>
                      <Link href="/settings">Settings</Link>
                    </Menu.Item>
                    <Menu.Item
                      value="logout"
                      onClick={() =>
                        void signOut({
                          callbackUrl: window.location.origin,
                        })
                      }
                    >
                      Logout
                    </Menu.Item>
                  </Menu.ItemGroup>
                </Menu.Content>
              </Portal>
            )}
          </Menu.Root>
        </HStack>
      </HStack>

      {/* Main content area with sidebar */}
      <HStack
        width="full"
        alignItems="stretch"
        gap={0}
        minHeight="calc(100vh - 60px)"
      >
        <MainMenu isCompact={compactMenu} />

        <Box
          width="full"
          height="full"
          background="white"
          borderTopLeftRadius="xl"
          overflow="auto"
          display="flex"
          minHeight="calc(100vh - 56px)"
          maxHeight="calc(100vh - 56px)"
          maxWidth={`calc(100vw - ${menuWidth})`}
        >
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
                      Please check your environment variables, the following
                      variables are not set which are required for evaluations
                      and workflows:
                    </Text>
                    {!publicEnv.data?.HAS_LANGWATCH_NLP_SERVICE && (
                      <Text>LANGWATCH_NLP_SERVICE</Text>
                    )}
                    {!publicEnv.data?.HAS_LANGEVALS_ENDPOINT && (
                      <Text>LANGEVALS_ENDPOINT</Text>
                    )}
                  </Alert.Content>
                </Alert.Root>
              )}
            {usage.data &&
              usage.data.currentMonthMessagesCount >=
                usage.data.activePlan.maxMessagesPerMonth && (
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
                      {numeral(
                        usage.data.activePlan.maxMessagesPerMonth,
                      ).format()}{" "}
                      messages for this month, new messages will not be
                      processed.{" "}
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
                  </Alert.Content>
                </Alert.Root>
              )}
            {usage.data &&
              usage.data.currentMonthCost > usage.data.maxMonthlyUsageLimit && (
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
                      {numeral(usage.data.maxMonthlyUsageLimit).format("$0.00")}{" "}
                      usage cost for this month, evaluations and guardrails will
                      not be processed.{" "}
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

            {userIsPartOfTeam ? (
              children
            ) : (
              <Alert.Root
                status="warning"
                width="full"
                borderBottom="1px solid"
                borderBottomColor="yellow.300"
              >
                <Alert.Indicator />
                <Alert.Content>
                  <Text>
                    You are not part of any team in this organization, please
                    ask your administrator to add you to a team.
                  </Text>
                </Alert.Content>
              </Alert.Root>
            )}
          </VStack>
        </Box>
      </HStack>
    </Box>
  );
};
