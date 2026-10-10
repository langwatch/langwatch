/**
 * "Starred dashboards" in the other products' sidebars, lent through `StarredDashboardsToken`
 * (§10.1): the first 7 stars in the member's order, then "All starred (N)" if more. Draws
 * nothing while the stars load, when they fail, or when the member has starred none.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import type { StarredDashboardsProps } from "@langwatch/analytics-client";
import { Box, Link as ChakraLink, Text, VStack } from "@langwatch/design-system/primitives";
import { Star } from "lucide-react";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { opensElsewhere } from "../../../../ui/elements/analytics-link.tsx";
import { useFavourites } from "../../behavior/use-favourites.ts";
import { dashboardsPath } from "../../model/boards.ts";
import { CURATED_BOARDS } from "../../model/curated-boards.ts";
import { type StarredLink, starredLinks } from "../../model/sidebar-boards.ts";

/** Rows shown before the rest sit behind "All starred (N)": the sidebar stays short. */
const STARRED_ELSEWHERE_MAX = 7;

export function StarredDashboardsSection(_props: StarredDashboardsProps) {
  const host = useAnalyticsHost();
  const favourites = useFavourites();
  const projectSlug = host.project()?.slug;
  if (!projectSlug || favourites.isLoading || favourites.loadError) return null;
  const links = starredLinks({ stars: favourites.stars, curated: CURATED_BOARDS, projectSlug });
  if (links.length === 0) return null;
  const shown = links.slice(0, STARRED_ELSEWHERE_MAX);
  return (
    <VStack as="section" aria-label="Starred dashboards" align="stretch" gap={0.5} width="full">
      <Text
        paddingX={2}
        marginTop={3}
        marginBottom={0.5}
        fontSize="9px"
        fontWeight="semibold"
        letterSpacing="0.09em"
        textTransform="uppercase"
        color="fg.subtle"
      >
        Starred dashboards
      </Text>
      <VStack as="ul" align="stretch" gap={0.5} margin={0} padding={0}>
        {shown.map((link) => (
          <StarredRow key={link.key} link={link} />
        ))}
        {links.length > STARRED_ELSEWHERE_MAX && (
          <StarredRow
            link={{
              key: "all-starred",
              name: `All starred (${links.length})`,
              href: dashboardsPath({ projectSlug }),
            }}
            isAll
          />
        )}
      </VStack>
    </VStack>
  );
}

function StarredRow({ link, isAll = false }: { link: StarredLink; isAll?: boolean }) {
  const host = useAnalyticsHost();
  return (
    <Box as="li" listStyleType="none" width="full">
      <ChakraLink
        href={link.href}
        display="flex"
        alignItems="center"
        gap={2}
        width="full"
        borderRadius="lg"
        paddingX={2}
        paddingY="4px"
        fontSize="13px"
        color="fg.subtle"
        textDecoration="none"
        _hover={{ color: "fg", background: "border/50" }}
        onClick={(event) => {
          if (opensElsewhere(event)) return;
          event.preventDefault();
          host.navigate(link.href);
        }}
      >
        {!isAll && (
          <Box as="span" display="flex" flexShrink={0} color="yellow.solid">
            <Star size={14} fill="currentColor" strokeWidth={1.9} aria-hidden />
          </Box>
        )}
        <Text as="span" truncate minWidth={0}>
          {link.name}
        </Text>
      </ChakraLink>
    </Box>
  );
}
