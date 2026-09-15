/**
 * The automations screen frame and tab navigation (overview, automations,
 * alerts, schedules). Extracted to be a composable feature-web section layout.
 */

import { Box, Container, HStack, Spacer, Stack, Text } from "@chakra-ui/react";
import type { LucideIcon } from "lucide-react";
import { Calendar, Eye, TrendingUp, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "../elements/automation-link.tsx";

const SECTION_LABEL = "Automations";

export type AutomationSection = "overview" | "automations" | "alerts" | "schedules";

/** The four tabs, in the order the page has always listed them. */
export const AUTOMATION_SECTIONS: readonly {
  section: AutomationSection;
  label: string;
  /** Appended to the family's base path; empty for the overview. */
  suffix: string;
  icon: LucideIcon;
}[] = [
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
