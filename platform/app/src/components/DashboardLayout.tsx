import { Box, HStack, type StackProps } from "@chakra-ui/react";
import { NavigationV2Shell } from "../features/navigation/shell/NavigationV2Shell";
import { useNavigationMode } from "../features/navigation/useNavigationMode";
import { useRequiredSession } from "../hooks/useRequiredSession";
import { usePublicEnv } from "../hooks/usePublicEnv";
import Head from "../utils/compat/next-head";
import { AppHeaderUserMenu } from "./AppHeaderUserMenu";
import { DashboardPageBody } from "./DashboardPageBody";
import { FullLogo } from "./icons/FullLogo";
import { DevBadge } from "./ui/DevBadge";
import { Link } from "./ui/link";

export type DashboardLayoutProps = {
  publicPage?: boolean;
  compactMenu?: boolean;
  /**
   * Set on personal-scope routes (`/me`, `/me/configure`) where the page
   * intentionally has no project context. Disables the OTP hook's
   * "no project → bounce to /onboarding or /<defaultProjectSlug>"
   * redirect, which would otherwise hijack the route on first paint.
   */
  personalScope?: boolean;
  /**
   * Set on org-scope routes (`/governance`) where the page is scoped to
   * an organization, not a project. Same effect as `personalScope` on
   * project-redirect gating, but in the top bar replaces the project
   * scope control with the organization one.
   */
  orgScope?: boolean;
  /**
   * Override the default `LangWatch - {project.name}` tab title.
   * When set, the layout's <Head> emits this string verbatim.
   * Set on org-scope routes (governance overview, view-all listings,
   * detail pages) where the project-based default would otherwise read
   * "LangWatch - Personal Workspace" because the user has no active
   * project. Child <Head> writers lost the layout-effect race against
   * the parent layout's <Head>, so the only correct fix is to push the
   * title down through props.
   */
  pageTitle?: string;
} & StackProps;

/**
 * Entry point for the app chrome. Signed-in pages render in one of the
 * two navigation shells, picked by the device's mode
 * (specs/navigation/navigation-modes.feature). Public pages carry no
 * session to resolve anything against, so they render in a plain frame
 * of their own.
 */
export const DashboardLayout = (dashboardProps: DashboardLayoutProps) => {
  if (dashboardProps.publicPage) {
    return <PublicPageFrame {...dashboardProps} />;
  }
  return <ShellDashboardLayout {...dashboardProps} />;
};

const ShellDashboardLayout = (dashboardProps: DashboardLayoutProps) => {
  const mode = useNavigationMode();
  return <NavigationV2Shell mode={mode} {...dashboardProps} />;
};

/**
 * The frame for a page rendered with no session, today only the shared
 * trace page: a logo, the sign-in entry, and the page body in a card.
 * No navigation mode is consulted and no sidebar renders, because every
 * link in one needs an account.
 *
 * Spec: specs/navigation/navigation-modes.feature
 */
const PublicPageFrame = ({
  children,
  pageTitle,
  ...props
}: DashboardLayoutProps) => {
  useRequiredSession({ required: false });
  const publicEnv = usePublicEnv();

  return (
    <Box width="full" minHeight="100vh" background="bg.page">
      <Head>
        <title>{pageTitle ?? "LangWatch"}</title>
      </Head>
      <HStack
        position="relative"
        width="full"
        height="60px"
        paddingX={4}
        paddingY={3}
        background="bg.page"
        justifyContent="space-between"
        gap={4}
      >
        <Link href="/" display="flex" alignItems="center">
          <FullLogo width={155 * 0.7} height={38 * 0.7} />
        </Link>
        <HStack gap={2} justifyContent="flex-end">
          {publicEnv.data?.NODE_ENV === "development" && <DevBadge />}
          <AppHeaderUserMenu publicPage />
        </HStack>
      </HStack>
      <Box
        width="full"
        height="full"
        background="bg.page"
        minHeight="calc(100vh - 60px)"
        maxHeight="calc(100vh - 60px)"
      >
        <Box
          width="full"
          height="full"
          background="bg.surface"
          borderTopLeftRadius="xl"
          borderTopWidth="1px"
          borderLeftWidth="1px"
          borderStyle="solid"
          borderColor="border.muted"
          overflow="auto"
          display="flex"
          minHeight="calc(100vh - 60px)"
          maxHeight="calc(100vh - 60px)"
          position="relative"
        >
          <DashboardPageBody publicPage {...props}>
            {children}
          </DashboardPageBody>
        </Box>
      </Box>
    </Box>
  );
};
