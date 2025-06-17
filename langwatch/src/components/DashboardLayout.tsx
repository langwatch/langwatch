import {
  Alert,
  Avatar,
  Badge,
  Box,
  Button,
  HStack,
  Input,
  Portal,
  Spacer,
  Text,
  VStack,
  type StackProps,
} from "@chakra-ui/react";
import { type Organization, type Project, type Team } from "@prisma/client";
import { signIn, signOut } from "next-auth/react";
import ErrorPage from "next/error";
import Head from "next/head";
import { useRouter } from "next/router";
import numeral from "numeral";
import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Lock, Plus, Search } from "react-feather";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { usePublicEnv } from "../hooks/usePublicEnv";
import { useRequiredSession } from "../hooks/useRequiredSession";
import { dependencies } from "../injection/dependencies.client";
import type { FullyLoadedOrganization } from "../server/api/routers/organization";
import { api } from "../utils/api";
import { findCurrentRoute, projectRoutes, type Route } from "../utils/routes";
import { trackEvent } from "../utils/tracking";
import { CurrentDrawer } from "./CurrentDrawer";
import { HoverableBigText } from "./HoverableBigText";
import { IntegrationChecks, useIntegrationChecks } from "./IntegrationChecks";
import { LoadingScreen } from "./LoadingScreen";
import { MainMenu, MENU_WIDTH } from "./MainMenu";
import { ProjectTechStackIcon } from "./TechStack";
import { ChecklistIcon } from "./icons/Checklist";
import { useColorRawValue } from "./ui/color-mode";
import { InputGroup } from "./ui/input-group";
import { Link } from "./ui/link";
import { Menu } from "./ui/menu";
import { Popover } from "./ui/popover";
import { Tooltip } from "./ui/tooltip";

const Breadcrumbs = ({ currentRoute }: { currentRoute: Route | undefined }) => {
  const { project } = useOrganizationTeamProject();

  return (
    currentRoute && (
      <HStack gap={2} fontSize="13px" color="gray.500">
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
        <HoverableBigText lineClamp={1} expandable={false}>
          {currentRoute.title}
        </HoverableBigText>
      </HStack>
    )
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
    }))
  );

  return (
    <Menu.Root open={open} onOpenChange={({ open }) => setOpen(open)}>
      <Menu.Trigger asChild>
        <Button
          variant="outline"
          borderColor="gray.300"
          fontSize="13px"
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
              <ChevronDown />
            </Box>
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
                      (member) => member.userId === session?.user.id
                    )
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
                            href={
                              currentRoute?.path.includes("[project]")
                                ? currentRoute.path
                                    .replace("[project]", project_.slug)
                                    .replace(/\[.*?\]/g, "")
                                    .replace(/\/\/+/g, "/")
                                : window.location.pathname.includes(
                                    project.slug
                                  )
                                ? window.location.pathname.replace(
                                    project.slug,
                                    project_.slug
                                  )
                                : `/${project_.slug}?return_to=${window.location.pathname}`
                            }
                            _hover={{
                              textDecoration: "none",
                            }}
                          >
                            <HStack width="26px" justify="center">
                              <ProjectTechStackIcon project={project_} />
                            </HStack>{" "}
                            {project_.name}
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

export const DashboardLayout = ({
  children,
  publicPage = false,
  ...props
}: { publicPage?: boolean } & StackProps) => {
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
    }
  );
  const publicEnv = usePublicEnv();

  const [query, setQuery] = useState(router.query.query as string);

  const integrationChecks = useIntegrationChecks();

  const integrationsLeft = useMemo(() => {
    return Object.entries(integrationChecks.data ?? {}).filter(
      ([key, value]) => key !== "integrated" && !value
    ).length;
  }, [integrationChecks.data]);

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

  return (
    <HStack
      width="full"
      minHeight="100vh"
      alignItems={"stretch"}
      gap={0}
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
      <MainMenu />
      <VStack
        width={`calc(100vw - ${MENU_WIDTH})`}
        maxWidth={`calc(100vw - ${MENU_WIDTH})`}
        gap={0}
        background="gray.100"
        {...props}
      >
        {publicEnv.data &&
          (!publicEnv.data?.LANGWATCH_NLP_SERVICE ||
            !publicEnv.data?.LANGEVALS_ENDPOINT) && (
            <Alert.Root
              status="warning"
              width="full"
              borderBottom="1px solid"
              borderBottomColor="yellow.300"
            >
              <Alert.Indicator />
              <Alert.Content>
                <Text>
                  Please check your environment variables, the following
                  variables are not set which are required for evaluations and
                  workflows:
                </Text>
                {!publicEnv.data?.LANGWATCH_NLP_SERVICE && (
                  <Text>LANGWATCH_NLP_SERVICE</Text>
                )}
                {!publicEnv.data?.LANGEVALS_ENDPOINT && (
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
                  usage cost for this month, evaluations and guardrails will not
                  be processed.{" "}
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
            <Box display={["none", "none", "block"]}>
              <Breadcrumbs currentRoute={currentRoute} />
            </Box>
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
              <InputGroup
                borderColor="gray.300"
                startElement={<Search color={gray400} width={16} />}
                width="full"
              >
                <Input
                  name="query"
                  type="search"
                  placeholder="Search"
                  _placeholder={{ color: "gray.800" }}
                  fontSize="14px"
                  paddingY={1.5}
                  width="full"
                  height="auto"
                  value={query ?? router.query.query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </InputGroup>
            </form>
          )}
          <HStack gap={6} flex={1}>
            <Spacer />
            <HStack gap={4}>
              {integrationsLeft ? (
                <Popover.Root positioning={{ placement: "bottom-end" }}>
                  <Popover.Trigger asChild>
                    <Button position="relative" variant="ghost">
                      <ChecklistIcon
                        style={{ maxWidth: "24px", maxHeight: "24px" }}
                      />
                      <Badge
                        position="absolute"
                        bottom="-4px"
                        right="-2px"
                        size="xs"
                        color="white"
                        backgroundColor="green.500"
                        borderRadius="full"
                        fontSize="12px"
                        fontWeight="600"
                      >
                        {integrationsLeft}
                      </Badge>
                    </Button>
                  </Popover.Trigger>
                  <Popover.Content>
                    <Popover.Body>
                      <IntegrationChecks />
                    </Popover.Body>
                  </Popover.Content>
                </Popover.Root>
              ) : (
                <Box width={["auto", "auto", "auto", "55px"]} />
              )}
              <Menu.Root>
                <Menu.Trigger asChild>
                  <Button
                    variant="plain"
                    {...(publicPage
                      ? { onClick: () => void signIn("auth0") }
                      : {})}
                  >
                    <Avatar.Root
                      size="sm"
                      backgroundColor="orange.400"
                      color="white"
                    >
                      <Avatar.Fallback name={user?.name ?? undefined} />
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
