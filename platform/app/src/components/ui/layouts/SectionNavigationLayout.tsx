import { Box, HStack, Link, Spacer, Stack, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { ProductPageFrame } from "~/features/navigation/shell/ProductPageFrame";
import { useNavigationV2ShellActive } from "~/features/navigation/useNavigationV2ShellActive";
import NextLink from "~/utils/compat/next-link";
import { usePathname } from "~/utils/compat/next-navigation";

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
  /**
   * Set when the navigation-v2 product sidebar lists the same pages this
   * rail does (Gateway, Governance). Inside a v2 shell the rail then
   * stands down and the content takes the full width; a section whose
   * rail lists page-local destinations (Automations) leaves this unset
   * and keeps its rail in every mode.
   * Spec: specs/navigation/shared-section-navigation-layout.feature
   */
  standDownRailInProductShell?: boolean;
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
  standDownRailInProductShell = false,
}: SectionNavigationLayoutProps) {
  const isV2ShellActive = useNavigationV2ShellActive();
  const railStandsDown = standDownRailInProductShell && isV2ShellActive;
  return (
    <DashboardLayout orgScope={orgScope} pageTitle={pageTitle}>
      {railStandsDown ? (
        <ProductPageFrame>{children}</ProductPageFrame>
      ) : (
        /* DashboardLayout gives the page no inset of its own, so the rail
           path pads here — the same inset ProductPageFrame draws on the v2
           path, and the only padding on either. The frame itself draws none:
           mounted inside SettingsLayout it sits in a container that already
           padded the page, and a second helping was the doubled gutter this
           used to ship with.

           THE WIDTH CAP STAYS ON THIS PATH. Removing the frame's nested
           container took the 1600px with it, which on a wide display made
           these pages full-bleed — a change to how every one of them reads,
           made as a side effect of deleting a duplicated gutter. Inside
           SettingsLayout the cap is the settings container's (1280px, which
           is narrower anyway); here there is nothing else to draw it. */
        <Box
          padding={4}
          maxW="1600px"
          width="full"
          data-testid="section-navigation-container"
        >
          <SectionNavigationFrame
            sectionLabel={sectionLabel}
            navigationItems={navigationItems}
            sidebarFooter={sidebarFooter}
          >
            {children}
          </SectionNavigationFrame>
        </Box>
      )}
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
    /* NO PADDING, NO WIDTH CAP. This frame used to nest a second container —
       1600px and another padding — inside whatever already framed the page.
       Inside SettingsLayout that is a 1280px container with its own padding,
       so the cap could never be reached and the gutter was drawn twice. The
       inset now belongs to whoever mounts the frame: SettingsLayout on the
       settings pages, SectionNavigationLayout on the dashboard path. */
    <Box width="full" data-testid="section-navigation-layout">
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
                <RailLink item={item} />
              </Box>
            ))}
          </Stack>
          {sidebarFooter}
        </Box>

        <Box flex={1} minWidth={0} data-testid="section-navigation-content">
          {children}
        </Box>
      </Stack>
    </Box>
  );
}

/**
 * One destination on the rail.
 *
 * Not MenuLink: the shared sidebar link paints its selection with a muted
 * wash, which is right for a long menu and wrong here — the rail is the
 * section's own tab row, and the current destination is the answer to
 * "where am I", so it earns the brand accent rather than the wash. The
 * selection rule is MenuLink's own (the exact path, or the path a section
 * prefix covers), kept in step so a destination is current in exactly the
 * places it always was.
 *
 * The strip below `md` and the column above it render this same link, so
 * the treatment — rounded, quiet until hovered, accented when current — is
 * written once and cannot drift between the two.
 */
function RailLink({ item }: { item: SectionNavigationItem }) {
  const pathname = usePathname();
  const selected =
    pathname === item.href ||
    (item.includePath ? !!pathname?.includes(item.includePath) : false);

  return (
    <Link
      asChild
      display="block"
      width="full"
      paddingX={3}
      paddingY={1.5}
      borderRadius="lg"
      colorPalette="orange"
      background={selected ? "colorPalette.subtle" : "transparent"}
      color={selected ? "colorPalette.fg" : undefined}
      // A muted hover over the accent would grey out the one answer the rail
      // exists to give, so the current destination keeps its wash on hover.
      _hover={{ background: selected ? "colorPalette.subtle" : "bg.muted" }}
      transition="background 0.15s ease, color 0.15s ease"
    >
      <NextLink
        href={item.href}
        {...(item.target
          ? { target: item.target, rel: "noopener noreferrer" }
          : {})}
      >
        <HStack width="full" gap={2}>
          {item.icon}
          <Text>{item.label}</Text>
          <Spacer />
          {item.menuEnd}
        </HStack>
      </NextLink>
    </Link>
  );
}
