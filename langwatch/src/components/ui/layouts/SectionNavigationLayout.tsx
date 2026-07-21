import { Box, Container, HStack, Text, VStack } from "@chakra-ui/react";
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
        <HStack alignItems="start" gap={6} width="full">
          <Box
            as="nav"
            aria-label={`${sectionLabel} navigation`}
            width="220px"
            minWidth="220px"
            flexShrink={0}
            borderRightWidth="1px"
            borderRightColor="border.muted"
            paddingRight={4}
          >
            <VStack align="stretch" gap={1}>
              <Text
                data-testid="section-navigation-title"
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
              {navigationItems.map((item) => (
                <MenuLink
                  key={`${item.href}:${item.label}`}
                  href={item.href}
                  includePath={item.includePath}
                  icon={item.icon}
                  menuEnd={item.menuEnd}
                  target={item.target}
                >
                  {item.label}
                </MenuLink>
              ))}
            </VStack>
            {sidebarFooter}
          </Box>

          <Box flex={1} minWidth={0} data-testid="section-navigation-content">
            {children}
          </Box>
        </HStack>
      </Container>
    </Box>
  );
}
