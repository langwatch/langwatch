import { Link } from "@chakra-ui/next-js";
import {
  Avatar,
  Box,
  Button,
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
  Portal,
  Spacer,
  Text,
  VStack,
  useTheme,
  type BackgroundProps,
  Stack,
  Switch,
} from "@chakra-ui/react";
import { type Project } from "@prisma/client";
import { signOut } from "next-auth/react";
import ErrorPage from "next/error";
import Head from "next/head";
import { useRouter } from "next/router";
import { useState, type PropsWithChildren, useEffect } from "react";
import {
  ChevronDown,
  ChevronRight,
  TrendingUp,
  MessageSquare,
  Plus,
  Search,
  Settings,
  Shield,
  type Icon,
} from "react-feather";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { useRequiredSession } from "../hooks/useRequiredSession";
import type { FullyLoadedOrganization } from "../server/api/routers/organization";
import { findCurrentRoute, projectRoutes, type Route } from "../utils/routes";
import { LoadingScreen } from "./LoadingScreen";
import { ProjectTechStackIcon } from "./TechStack";
import { LogoIcon } from "./icons/LogoIcon";
import { dependencies } from "../injection/dependencies.client";
import { OrganizationRoleGroup } from "../server/api/permission";
import { useDevView } from "../hooks/DevViewProvider";

const Breadcrumbs = ({ currentRoute }: { currentRoute: Route | undefined }) => {
  const { project } = useOrganizationTeamProject();

  return (
    currentRoute && (
      <HStack gap={2} fontSize={13} color="gray.500">
        <Link href="/">Dashboard</Link>
        {currentRoute.parent && (
          <>
            <ChevronRight width="12" />
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
        <ChevronRight width="12" />
        <Text>{currentRoute.title}</Text>
      </HStack>
    )
  );
};

const SideMenuLink = ({
  icon,
  label,
  path,
  project,
}: {
  icon: Icon;
  label: string;
  path: string;
  project: Project;
}) => {
  const router = useRouter();
  const currentRoute = findCurrentRoute(router.pathname);

  const theme = useTheme();
  const orange400 = theme.colors.orange["400"];

  const IconElem = icon;

  const isActive =
    currentRoute?.path === path ||
    (path.includes("/messages") && router.pathname.includes("/messages")) ||
    (path.includes("/guardrails") && router.pathname.includes("/guardrails")) ||
    (path.includes("/settings") && router.pathname.includes("/settings"));

  return (
    <Link href={path.replace("[project]", project.slug)} aria-label={label}>
      <VStack>
        <IconElem size={24} color={isActive ? orange400 : undefined} />
      </VStack>
    </Link>
  );
};

const ProjectSelector = ({
  organizations,
  project,
}: {
  organizations: FullyLoadedOrganization[];
  project: Project;
}) => {
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

  return (
    <Menu>
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
                      (projectGroup.team.name !== projectGroup.organization.name
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
                            : `/${project.slug}`
                        }
                        _hover={{
                          textDecoration: "none",
                        }}
                      >
                        <MenuItem
                          icon={<ProjectTechStackIcon project={project} />}
                          fontSize="14px"
                        >
                          {project.name}
                        </MenuItem>
                      </Link>
                    ))}
                    <Link
                      href={`/onboarding/${projectGroup.team.slug}/project`}
                      _hover={{
                        textDecoration: "none",
                      }}
                    >
                      <MenuItem icon={<Plus />} fontSize="14px">
                        New Project
                      </MenuItem>
                    </Link>
                  </MenuGroup>
                ))}
            </>
          </MenuList>
        </Box>
      </Portal>
    </Menu>
  );
};

export const DashboardLayout = ({
  children,
  ...bgProps
}: PropsWithChildren<BackgroundProps>) => {
  const router = useRouter();
  const theme = useTheme();
  const gray400 = theme.colors.gray["400"];
  const { isDevViewEnabled, toggleDevView } = useDevView();

  const { data: session } = useRequiredSession();

  const {
    isLoading,
    organization,
    organizations,
    team,
    project,
    hasOrganizationPermission,
  } = useOrganizationTeamProject();

  const [query, setQuery] = useState("");

  if (typeof router.query.project === "string" && !isLoading && !project) {
    return <ErrorPage statusCode={404} />;
  }

  if (
    !session ||
    isLoading ||
    !organization ||
    !organizations ||
    !team ||
    !project
  ) {
    return <LoadingScreen />;
  }

  const user = session.user;
  const currentRoute = findCurrentRoute(router.pathname);

  return (
    <HStack width="full" minHeight="100vh" alignItems={"stretch"} spacing={0}>
      <Head>
        <title>
          LangWatch - {project.name}
          {currentRoute && currentRoute.title != "Home"
            ? ` - ${currentRoute?.title}`
            : ""}
        </title>
      </Head>
      <Box
        borderRightWidth="1px"
        borderRightColor="gray.300"
        background="white"
      >
        <VStack paddingX={6} paddingY={8} spacing={8} position="sticky" top={0}>
          <Box fontSize={32} fontWeight="bold">
            <LogoIcon width={25} height={34} />
          </Box>
          <Text
            whiteSpace="nowrap"
            bg="blue.500"
            color="white"
            paddingX="2"
            paddingY="1"
            borderRadius="lg"
            fontSize={11}
            fontWeight="bold"
            hidden={!isDevViewEnabled}
          >
            Dev Mode
          </Text>
          <VStack spacing={8}>
            <SideMenuLink
              path={projectRoutes.home.path}
              icon={TrendingUp}
              label={projectRoutes.home.title}
              project={project}
            />
            <SideMenuLink
              path={projectRoutes.messages.path}
              icon={MessageSquare}
              label={projectRoutes.messages.title}
              project={project}
            />
            {/* <SideMenuLink
              path={projectRoutes.analytics.path}
              icon={TrendingUp}
              label={projectRoutes.analytics.title}
              project={project}
            />*/}
            <SideMenuLink
              path={projectRoutes.checks.path}
              icon={Shield}
              label={projectRoutes.checks.title}
              project={project}
            />
            {/*<SideMenuLink
              path={projectRoutes.prompts.path}
              icon={Database}
              label={projectRoutes.prompts.title}
              project={project}
            /> */}
            {hasOrganizationPermission(
              OrganizationRoleGroup.ORGANIZATION_VIEW
            ) && (
              <SideMenuLink
                path={projectRoutes.settings.path}
                icon={Settings}
                label={projectRoutes.settings.title}
                project={project}
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
        {...bgProps}
      >
        <HStack
          position="relative"
          zIndex={3}
          width="full"
          padding={4}
          gap={6}
          background="white"
          borderBottomWidth="1px"
          borderBottomColor="gray.300"
        >
          <ProjectSelector organizations={organizations} project={project} />
          <Hide below="lg">
            <Breadcrumbs currentRoute={currentRoute} />
          </Hide>
          <Spacer />
          {currentRoute !== projectRoutes.messages && (
            <form
              action={`${project.slug}/messages`}
              method="GET"
              style={{ width: "100%", maxWidth: "600px" }}
              onSubmit={(e) => {
                e.preventDefault();
                void router.push(`${project.slug}/messages?query=${query}`);
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
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </InputGroup>
            </form>
          )}
          <Spacer />
          <Menu>
            {currentRoute === projectRoutes.messages && (
              <>
                <Stack align="center" direction="row">
                  <Switch
                    size={"lg"}
                    onChange={toggleDevView}
                    isChecked={isDevViewEnabled}
                  />
                </Stack>
              </>
            )}

            <MenuButton as={Button} variant="unstyled">
              <Avatar
                name={user.name ?? undefined}
                backgroundColor={isDevViewEnabled ? "blue.500" : "orange.400"}
                color="white"
                size="sm"
              />
            </MenuButton>
            <Portal>
              <MenuList zIndex="popover">
                {dependencies.ExtraMenuItems && <dependencies.ExtraMenuItems />}
                <MenuGroup
                  title={`${session.user.name} (${session.user.email})`}
                >
                  <MenuItem
                    onClick={() =>
                      void signOut({ callbackUrl: window.location.origin })
                    }
                  >
                    Logout
                  </MenuItem>
                </MenuGroup>
              </MenuList>
            </Portal>
          </Menu>
        </HStack>
        {children}
      </VStack>
    </HStack>
  );
};
