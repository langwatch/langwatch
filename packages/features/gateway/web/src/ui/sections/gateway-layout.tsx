/**
 * The frame every `/gateway/*` page renders inside.
 *
 * `platform/app`'s `AiGatewayLayout` wrapped `SectionNavigationLayout`, which
 * wrapped `DashboardLayout` — the whole application chrome — and then, in the
 * navigation-v2 shell, stood its own rail down because the product sidebar
 * already listed the same pages. Two of those three layers are application
 * chrome a feature-web package may not import, and neither is the family's:
 * chrome belongs to the route tree, and the pages here are children of a layout
 * route the composing application still serves.
 *
 * So what moved is the middle layer only — the section rail and the content
 * column, harvested from `SectionNavigationFrame` — over the family's own copy
 * of the navigation rows. The rail filters itself the way the platform hook did:
 * an item behind a flag is listed only while the flag is on, asked through the
 * host rather than through a flag hook. No gateway row carries a flag today,
 * and the filter stays because the platform list it was copied from can grow
 * one at any time.
 *
 * KNOWN GAP, and the reason this file says so out loud: the outer
 * `DashboardLayout` does not come with it. A `/gateway` page served from
 * `apps/ui` renders this frame and its content, and the application header,
 * sidebar and org-scope chip are not above it until a chrome layout route
 * exists in the route table. That route is the next structural slice, not this
 * one.
 */

import { Box, Container, HStack, Spacer, Stack, Text } from "@chakra-ui/react";
import type { PropsWithChildren } from "react";
import { useGatewayHost } from "../../model/gateway-host";
import { gatewayNavItems } from "../../model/gateway-nav-items";
import { Link } from "../elements/gateway-link";

const SECTION_LABEL = "AI Gateway";

export default function AiGatewayLayout({ children }: PropsWithChildren<{ pageTitle?: string }>) {
  const host = useGatewayHost();
  const visibleItems = gatewayNavItems.filter(
    (item) => item.featureFlag === void 0 || host.isFeatureEnabled(item.featureFlag),
  );
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
              {visibleItems.map((item) => (
                // Each link keeps its intrinsic width in the horizontal strip,
                // so the strip scrolls rather than squeezing the labels.
                <Box key={`${item.href}:${item.label}`} flexShrink={0}>
                  <Link
                    href={item.href}
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
