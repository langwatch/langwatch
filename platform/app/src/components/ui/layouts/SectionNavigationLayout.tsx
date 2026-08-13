import { Box, Container, Stack, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { MenuLink } from "~/components/MenuLink";

export interface SectionNavigationItem {
  label: string;
  href: string;
  includePath?: string;
  icon?: ReactNode;
  menuEnd?: ReactNode;
  target?: string;
}

interface SectionNavigationFrameProps {
  children: ReactNode;
  sectionLabel: string;
  navigationItems: SectionNavigationItem[];
  sidebarFooter?: ReactNode;
}

interface SectionNavigationLayoutProps extends SectionNavigationFrameProps {
  pageTitle?: string;
  orgScope?: boolean;
}

/**
 * Shared shell for product areas with their own local navigation. Keeping the
 * width, divider, title placement, and content constraint here prevents these
 * workspaces from drifting into subtly different layouts.
 */
export function SectionNavigationLayout({
  children,
  sectionLabel,
  navigationItems,
  sidebarFooter,
  pageTitle,
  orgScope = false,
}: SectionNavigationLayoutProps) {
  return (
    <DashboardLayout orgScope={orgScope} pageTitle={pageTitle}>
      <SectionNavigationFrame
        sectionLabel={sectionLabel}
        navigationItems={navigationItems}
        sidebarFooter={sidebarFooter}
      >
        {children}
      </SectionNavigationFrame>
    </DashboardLayout>
  );
}

/**
 * Renders the shared navigation rail and adjacent content without the outer
 * dashboard chrome.
 *
 * Below `md` the rail stops being a rail: a fixed 220px column that never
 * shrinks leaves a phone-width window with a few pixels for the content,
 * which is not a narrow table, it is no table at all. It becomes a
 * horizontally scrollable strip of links above the content instead, and
 * the section label drops out because the page heading underneath already
 * says where you are.
 */
export function SectionNavigationFrame({
  children,
  sectionLabel,
  navigationItems,
  sidebarFooter,
}: SectionNavigationFrameProps) {
  return (
    <Box width="full" padding={4} data-testid="section-navigation-layout">
      <Container
        maxW="1600px"
        paddingX={0}
        data-testid="section-navigation-container"
      >
        <Stack
          direction={{ base: "column", md: "row" }}
          alignItems={{ base: "stretch", md: "start" }}
          gap={{ base: 3, md: 6 }}
          width="full"
        >
          <Box
            as="nav"
            aria-label={`${sectionLabel} navigation`}
            width={{ base: "full", md: "220px" }}
            minWidth={{ base: 0, md: "220px" }}
            flexShrink={0}
            borderRightWidth={{ base: 0, md: "1px" }}
            borderRightColor="border.muted"
            borderBottomWidth={{ base: "1px", md: 0 }}
            borderBottomColor="border.muted"
            paddingRight={{ base: 0, md: 4 }}
            paddingBottom={{ base: 2, md: 0 }}
          >
            <Text
              data-testid="section-navigation-title"
              display={{ base: "none", md: "block" }}
              fontSize="xs"
              fontWeight="semibold"
              color="fg.muted"
              paddingX={3}
              paddingTop={1}
              paddingBottom={2}
              textTransform="uppercase"
              letterSpacing="wider"
            >
              {sectionLabel}
            </Text>
            <Stack
              data-testid="section-navigation-links"
              direction={{ base: "row", md: "column" }}
              alignItems="stretch"
              gap={1}
              overflowX={{ base: "auto", md: "visible" }}
              paddingBottom={{ base: 1, md: 0 }}
            >
              {navigationItems.map((item) => (
                // Each link keeps its intrinsic width in the horizontal
                // strip. Without it the links shrink to fit the viewport
                // instead of overflowing, so the strip never scrolls and the
                // labels are squeezed.
                <Box key={`${item.href}:${item.label}`} flexShrink={0}>
                  <MenuLink
                    href={item.href}
                    includePath={item.includePath}
                    icon={item.icon}
                    menuEnd={item.menuEnd}
                    target={item.target}
                  >
                    {item.label}
                  </MenuLink>
                </Box>
              ))}
            </Stack>
            {sidebarFooter}
          </Box>

          <Box flex={1} minWidth={0} data-testid="section-navigation-content">
            {children}
          </Box>
        </Stack>
      </Container>
    </Box>
  );
}
