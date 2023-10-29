import { Link } from "@chakra-ui/next-js";
import {
  Avatar,
  Box,
  Button,
  HStack,
  Input,
  InputGroup,
  InputLeftElement,
  Spacer,
  Text,
  VStack,
  useTheme,
  type BackgroundProps,
} from "@chakra-ui/react";
import ErrorPage from "next/error";
import Image from "next/image";
import { useRouter } from "next/router";
import { type PropsWithChildren } from "react";
import {
  ChevronDown,
  ChevronRight,
  Database,
  Home,
  MessageSquare,
  Search,
  Shield,
  TrendingUp,
  type Icon,
} from "react-feather";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { useRequiredSession } from "../hooks/useRequiredSession";
import { findCurrentRoute, getProjectRoutes } from "../utils/routes";
import { LoadingScreen } from "./LoadingScreen";
import { LogoIcon } from "./icons/LogoIcon";
import Head from "next/head";

export const DashboardLayout = ({
  children,
  ...bgProps
}: PropsWithChildren<BackgroundProps>) => {
  const router = useRouter();
  const theme = useTheme();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const orange400 = theme.colors.orange["400"];
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const gray400 = theme.colors.gray["400"];

  const { data: session } = useRequiredSession();

  const { isLoading, organization, team, project } =
    useOrganizationTeamProject();

  if (!session || isLoading || !organization || !team || !project) {
    return <LoadingScreen />;
  }

  if (project && router.query.project !== project.slug) {
    return <ErrorPage statusCode={404} />;
  }

  const user = session.user;
  const projectRoutes = getProjectRoutes(project);
  const currentRoute = findCurrentRoute(project, router.pathname);

  const MenuButton = ({
    icon,
    label,
    path,
  }: {
    icon: Icon;
    label: string;
    path: string;
  }) => {
    const IconElem = icon;

    return (
      <Link href={path} aria-label={label}>
        <VStack>
          <IconElem
            size={24}
            color={currentRoute?.path === path ? orange400 : undefined}
          />
        </VStack>
      </Link>
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
            <MenuButton
              path={projectRoutes.home.path}
              icon={Home}
              label={projectRoutes.home.title}
            />
            <MenuButton
              path={projectRoutes.messages.path}
              icon={MessageSquare}
              label={projectRoutes.messages.title}
            />
            <MenuButton
              path={projectRoutes.analytics.path}
              icon={TrendingUp}
              label={projectRoutes.analytics.title}
            />
            <MenuButton
              path={projectRoutes.security.path}
              icon={Shield}
              label={projectRoutes.security.title}
            />
            <MenuButton
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
          <Button
            variant="outline"
            borderColor="gray.300"
            fontSize={13}
            paddingX={4}
            paddingY={1}
            height="auto"
            fontWeight="normal"
          >
            <HStack gap={2}>
              <Box>🦜 {project.name}</Box>
              <ChevronDown width={14} />
            </HStack>
          </Button>
          {currentRoute && (
            <HStack gap={2} fontSize={13} color="gray.500">
              {router.pathname === "/" ? (
                <Text>Dashboard</Text>
              ) : (
                <Link href="/">Dashboard</Link>
              )}
              <ChevronRight width="12" />
              <Text>{currentRoute.title}</Text>
            </HStack>
          )}
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
