/** The All dashboards header tabs: Dashboards and Templates, each its own URL. */

import {
  Box,
  Heading,
  HStack,
  Link as ChakraLink,
  VStack,
} from "@langwatch/design-system/primitives";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { opensElsewhere } from "../../../../ui/elements/analytics-menu-link.tsx";
import { dashboardsPath, dashboardTemplatesPath } from "../../model/boards.ts";

type TabKey = "dashboards" | "templates";

export function DashboardsTabs({ projectSlug, active }: { projectSlug: string; active: TabKey }) {
  const tabs: readonly { key: TabKey; label: string; href: string }[] = [
    { key: "dashboards", label: "Dashboards", href: dashboardsPath({ projectSlug }) },
    { key: "templates", label: "Templates", href: dashboardTemplatesPath({ projectSlug }) },
  ];
  return (
    <VStack align="stretch" gap={0}>
      <Heading as="h1" fontSize="19px" fontWeight="semibold" letterSpacing="tight">
        All dashboards
      </Heading>
      <HStack as="nav" aria-label="Dashboards and templates" gap={5} marginTop={3}>
        {tabs.map((tab) => (
          <Tab key={tab.key} label={tab.label} href={tab.href} isActive={tab.key === active} />
        ))}
      </HStack>
    </VStack>
  );
}

function Tab({ label, href, isActive }: { label: string; href: string; isActive: boolean }) {
  const host = useAnalyticsHost();
  return (
    <Box position="relative" paddingBottom={2}>
      <ChakraLink
        href={href}
        fontSize="14px"
        fontWeight="medium"
        color={isActive ? "fg" : "fg.muted"}
        textDecoration="none"
        _hover={{ color: "fg" }}
        aria-current={isActive ? "page" : void 0}
        onClick={(event) => {
          if (opensElsewhere(event)) return;
          event.preventDefault();
          host.navigate(href);
        }}
      >
        {label}
      </ChakraLink>
      {isActive && (
        <Box
          position="absolute"
          left={0}
          right={0}
          bottom={0}
          height="2px"
          borderRadius="full"
          background="teal.solid"
        />
      )}
    </Box>
  );
}
