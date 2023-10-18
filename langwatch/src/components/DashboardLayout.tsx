import { Box, Button, HStack, VStack, useTheme, Text } from "@chakra-ui/react";
import { type Session } from "next-auth";
import Image from "next/image";
import { useRouter } from "next/router";
import { type PropsWithChildren } from "react";
import {
  Database,
  Home,
  MessageSquare,
  Shield,
  TrendingUp,
  type Icon,
  ChevronDown,
  ChevronRight,
} from "react-feather";
import { type FullyLoadedOrganization } from "~/server/api/routers/organization";
import { findCurrentRoute, routes } from "../utils/routes";
import { Link } from "@chakra-ui/next-js";

export const DashboardLayout = ({
  user,
  organizations,
  children,
}: PropsWithChildren<{
  user: Session["user"];
  organizations: FullyLoadedOrganization[];
}>) => {
  const router = useRouter();
  const currentRoute = findCurrentRoute(router.pathname);

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
    const theme = useTheme();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const orange = theme.colors.orange["400"];

    return (
      <Link href={path} aria-label={label}>
        <VStack>
          <IconElem
            size={24}
            color={router.pathname === path ? orange : undefined}
          />
        </VStack>
      </Link>
    );
  };

  return (
    <HStack width="full" minHeight="100vh" alignItems={"stretch"} spacing={0}>
      <Box borderRightWidth="1px" borderRightColor="gray.300">
        <VStack
          paddingX={8}
          paddingY={8}
          spacing={16}
          position="sticky"
          top={0}
        >
          <Box fontSize={32} fontWeight="bold">
            <Image
              src="/images/logo-icon.svg"
              alt="LangWatch Logo"
              width="25"
              height="34"
            />
          </Box>
          <VStack spacing={8}>
            <MenuButton
              path={routes.home.path}
              icon={Home}
              label={routes.home.title}
            />
            <MenuButton
              path={routes.messages.path}
              icon={MessageSquare}
              label={routes.messages.title}
            />
            <MenuButton
              path={routes.analytics.path}
              icon={TrendingUp}
              label={routes.analytics.title}
            />
            <MenuButton
              path={routes.security.path}
              icon={Shield}
              label={routes.security.title}
            />
            <MenuButton
              path={routes.prompts.path}
              icon={Database}
              label={routes.prompts.title}
            />
          </VStack>
        </VStack>
      </Box>
      <VStack width="full" spacing={0} background="gray.200">
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
              <Box>🦜 Ecommerce Bot</Box>
              <ChevronDown width={14} />
            </HStack>
          </Button>
          {currentRoute && (
            <HStack gap={2} fontSize={12} color="gray.500">
              {router.pathname === "/" ? (
                <Text>Dashboard</Text>
              ) : (
                <Link href="/">Dashboard</Link>
              )}
              <ChevronRight width="12" />
              <Text>{currentRoute.title}</Text>
            </HStack>
          )}
        </HStack>
        {children}
      </VStack>
    </HStack>
  );
};
