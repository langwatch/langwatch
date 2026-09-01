/**
 * The frame the automations screen renders inside, and the four tabs that make
 * four URLs one screen.
 *
 * `platform/app` wrapped this page in `SectionNavigationLayout`, which wrapped
 * `DashboardLayout` — the whole application chrome — and passed it the four
 * navigation items inline. Two of those three layers are application chrome a
 * feature-web package may not import, and neither is this family's: chrome
 * belongs to the route tree, and this page is a child of a layout route the
 * composing application still serves.
 *
 * So what moved is the middle layer only — the section rail and the content
 * column — harvested the same way `@langwatch/gateway-web`'s
 * `AiGatewayLayout` was, and the tab list travels with it because the four
 * addresses are this screen's own. The rail is built from the project slug the
 * host resolves, so a reader with no project yet gets links that go nowhere
 * rather than links into another project.
 *
 * KNOWN GAP, stated the same way the gateway layout states it: the outer
 * `DashboardLayout` does not come with it. An automations page served from
 * `apps/ui` renders this frame and its content, and the application header,
 * sidebar and org-scope chip are not above it until a chrome layout route
 * exists in the route table. That route is a structural slice of its own.
 */

import { Box, Container, HStack, Spacer, Stack, Text } from "@chakra-ui/react";
import type { LucideIcon } from "lucide-react";
import { Calendar, Eye, TrendingUp, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "../elements/automation-link";

const SECTION_LABEL = "Automations";

export type AutomationSection = "overview" | "automations" | "alerts" | "schedules";

/** The four tabs, in the order the page has always listed them. */
export const AUTOMATION_SECTIONS: ReadonlyArray<{
  section: AutomationSection;
  label: string;
  /** Appended to the family's base path; empty for the overview. */
  suffix: string;
  icon: LucideIcon;
}> = [
  { section: "overview", label: "Overview", suffix: "", icon: Eye },
  { section: "automations", label: "Automations", suffix: "/automations", icon: Zap },
  { section: "alerts", label: "Alerts", suffix: "/alerts", icon: TrendingUp },
  { section: "schedules", label: "Schedules", suffix: "/schedules", icon: Calendar },
];

export function AutomationsLayout({
  basePath,
  children,
}: {
  basePath: string;
  children: ReactNode;
}) {
  return (
    <Box width="full" padding={4} data-testid="section-navigation-layout">
      <Container maxW="1600px" paddingX={0} data-testid="section-navigation-container">
        <Stack
          direction={{ base: "column", md: "row" }}
          alignItems={{ base: "stretch", md: "start" }}
          gap={{ base: 3, md: 6 }}
          width="full"
        >
          <Box
            as="nav"
            aria-label={`${SECTION_LABEL} navigation`}
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
              {SECTION_LABEL}
            </Text>
            <Stack
              data-testid="section-navigation-links"
              direction={{ base: "row", md: "column" }}
              alignItems="stretch"
              gap={1}
              overflowX={{ base: "auto", md: "visible" }}
              paddingBottom={{ base: 1, md: 0 }}
            >
              {AUTOMATION_SECTIONS.map((item) => (
                // Each link keeps its intrinsic width in the horizontal strip,
                // so the strip scrolls rather than squeezing the labels.
                <Box key={item.section} flexShrink={0}>
                  <Link
                    href={`${basePath}${item.suffix}`}
                    variant="plain"
                    paddingX={4}
                    paddingY={1}
                    width="full"
                    borderRadius="lg"
                    _hover={{ background: "bg.muted" }}
                  >
                    <HStack width="full" gap={2}>
                      <item.icon size={14} />
                      <Text>{item.label}</Text>
                      <Spacer />
                    </HStack>
                  </Link>
                </Box>
              ))}
            </Stack>
          </Box>

          <Box flex={1} minWidth={0} data-testid="section-navigation-content">
            {children}
          </Box>
        </Stack>
      </Container>
    </Box>
  );
}
