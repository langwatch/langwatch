import { Link } from "@chakra-ui/next-js";
import {
  Avatar,
  Box,
  Button,
  HStack,
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
} from "@chakra-ui/react";
import type { Project } from "@prisma/client";
import ErrorPage from "next/error";
import Head from "next/head";
import { useRouter } from "next/router";
import { type PropsWithChildren } from "react";
import {
  ChevronDown,
  ChevronRight,
  Database,
  Home,
  MessageSquare,
  Plus,
  Search,
  Shield,
  TrendingUp,
  type Icon,
} from "react-feather";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { useRequiredSession } from "../hooks/useRequiredSession";
import { getTechStack } from "./TechStack";
import { findCurrentRoute, projectRoutes, type Route } from "../utils/routes";
import { LoadingScreen } from "./LoadingScreen";
import { LogoIcon } from "./icons/LogoIcon";

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

export const DashboardLayout = ({
  children,
  ...bgProps
}: PropsWithChildren<BackgroundProps>) => {
  const router = useRouter();
  const theme = useTheme();
  const orange400 = theme.colors.orange["400"];
  const gray400 = theme.colors.gray["400"];

  const { data: session } = useRequiredSession();

  const { isLoading, organization, organizations, team, project } =
    useOrganizationTeamProject();

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

  if (
    project &&
    typeof router.query.project === "string" &&
    router.query.project !== project.slug
  ) {
    return <ErrorPage statusCode={404} />;
  }

  const user = session.user;
  const currentRoute = findCurrentRoute(router.pathname);

  const SideMenuLink = ({
    icon,
    label,
    path,
  }: {
    icon: Icon;
    label: string;
    path: string;
  }) => {
    const IconElem = icon;

    const isActive =
      currentRoute?.path === path ||
      (path.includes("/messages") && router.pathname.includes("/messages"));

    return (
      <Link href={path.replace("[project]", project.slug)} aria-label={label}>
        <VStack>
          <IconElem size={24} color={isActive ? orange400 : undefined} />
        </VStack>
      </Link>
    );
  };

  const ProjectTechStackIcon = ({ project }: { project: Project }) => {
    const IconWrapper = ({ children }: PropsWithChildren) => {
      return (
        <Box
          width="16px"
          height="16px"
          display="flex"
          alignItems="center"
          justifyContent="center"
        >
          {children}
        </Box>
      );
    };

    return (
      <HStack spacing={0}>
        <Box marginRight="-6px">
          <IconWrapper>{getTechStack(project).language.icon}</IconWrapper>
        </Box>
        <IconWrapper>{getTechStack(project).framework.icon}</IconWrapper>
      </HStack>
    );
  };

  const ProjectSelector = () => {
    const sortByName = (a: { name: string }, b: { name: string }) =>
      a.name.toLowerCase() < b.name.toLowerCase()
        ? -1
        : a.name.toLowerCase() > b.name.toLowerCase()
        ? 1
        : 0;

    const projectGroups = organizations
      .sort(sortByName)
      .flatMap((organization) =>
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
        >
          <HStack gap={2}>
            <ProjectTechStackIcon project={project} />
            <Box>{project.name}</Box>
            <ChevronDown width={14} />
          </HStack>
        </MenuButton>
        <Portal>
          <Box zIndex="popover" padding={0}>
            <MenuList>
              <>
                {projectGroups.map((projectGroup) => (
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
                        href={`/${project.slug}`}
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
        <VStack
          paddingX={8}
          paddingY={8}
          spacing={16}
          position="sticky"
          top={0}
        >
          <Box fontSize={32} fontWeight="bold">
            <LogoIcon width={25} height={34} />
          </Box>
          <VStack spacing={8}>
            <SideMenuLink
              path={projectRoutes.home.path}
              icon={Home}
              label={projectRoutes.home.title}
            />
            <SideMenuLink
              path={projectRoutes.messages.path}
              icon={MessageSquare}
              label={projectRoutes.messages.title}
            />
            <SideMenuLink
              path={projectRoutes.analytics.path}
              icon={TrendingUp}
              label={projectRoutes.analytics.title}
            />
            <SideMenuLink
              path={projectRoutes.security.path}
              icon={Shield}
              label={projectRoutes.security.title}
            />
            <SideMenuLink
              path={projectRoutes.prompts.path}
              icon={Database}
              label={projectRoutes.prompts.title}
            />
          </VStack>
        </VStack>
      </Box>
      <VStack width="full" spacing={0} background="gray.200" {...bgProps}>
        <HStack
          width="full"
          padding={4}
          gap={6}
          background="white"
          borderBottomWidth="1px"
          borderBottomColor="gray.300"
        >
          <ProjectSelector />
          <Breadcrumbs currentRoute={currentRoute} />
          <Spacer />
          <InputGroup maxWidth="600px" borderColor="gray.300">
            <InputLeftElement paddingY={1.5} height="auto" pointerEvents="none">
              <Search color={gray400} width={16} />
            </InputLeftElement>
            <Input
              type="search"
              placeholder="Search"
              _placeholder={{ color: "gray.800" }}
              fontSize={14}
              paddingY={1.5}
              height="auto"
            />
          </InputGroup>
          <Spacer />
          <Avatar
            name={user.name ?? undefined}
            backgroundColor="orange.400"
            color="white"
            size="sm"
          />
        </HStack>
        {children}
      </VStack>
    </HStack>
  );
};
