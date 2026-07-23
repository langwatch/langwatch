import {
  Box,
  Link as ChakraLink,
  HStack,
  Icon,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import NextLink from "~/utils/compat/next-link";
import type { ReactNode } from "react";
import { LuCircleX } from "react-icons/lu";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { RecentItem, RecentItemType } from "~/server/home/types";
import {
  HOME_SECTION_GAP,
  HomeSectionHeader,
} from "./HomeSectionHeader";
import { api } from "~/utils/api";
import { featureIcons, recentItemTypeToFeature } from "~/utils/featureIcons";
import { formatTimeAgo } from "~/utils/formatTimeAgo";
import { HomeCard } from "./HomeCard";

/**
 * Get icon for entity type using shared featureIcons config
 */
const getIconForType = (type: RecentItemType): ReactNode => {
  const featureKey = recentItemTypeToFeature[type];
  const config = featureKey ? featureIcons[featureKey] : null;
  if (config) {
    return <Icon as={config.icon} width="14px" height="14px" display="block" />;
  }
  return (
    <Icon
      as={featureIcons.home.icon}
      width="14px"
      height="14px"
      display="block"
    />
  );
};

/**
 * Get label for entity type using shared featureIcons config
 */
const getLabelForType = (type: RecentItemType): string => {
  const featureKey = recentItemTypeToFeature[type];
  const config = featureKey ? featureIcons[featureKey] : null;
  // Remove trailing 's' for singular form (e.g., "Prompts" -> "Prompt")
  const label = config?.label ?? "Item";
  return label.endsWith("s") ? label.slice(0, -1) : label;
};

/**
 * Group items by type — kept for consumers/tests even though the section now
 * renders one flat list (each row carries its own type label instead).
 */
export const groupItemsByType = (
  items: RecentItem[],
): Map<RecentItemType, RecentItem[]> => {
  const grouped = new Map<RecentItemType, RecentItem[]>();
  for (const item of items) {
    const existing = grouped.get(item.type) ?? [];
    grouped.set(item.type, [...existing, item]);
  }
  return grouped;
};

const MAX_RECENT_ROWS = 8;

/**
 * One recent item as a dense, scannable row: what it is (icon + type), what
 * it's called, and how long ago you touched it — a work log line, not a tile.
 * More useful than the old card grid: twice the items in half the height,
 * with recency visible at a glance.
 */
function RecentItemRow({ item }: { item: RecentItem }) {
  const timeAgo = formatTimeAgo(item.updatedAt.getTime());
  return (
    <ChakraLink
      asChild
      _hover={{ textDecoration: "none" }}
      width="full"
      display="block"
    >
      <NextLink href={item.href}>
        <HStack
          gap={2.5}
          align="center"
          paddingX={2.5}
          paddingY="7px"
          borderRadius="10px"
          transition="background 130ms ease"
          _hover={{ background: "bg.muted" }}
        >
          <Box
            flexShrink={0}
            padding={1.5}
            borderRadius="md"
            background="bg.muted"
            color="fg.muted"
            display="grid"
            placeItems="center"
          >
            {getIconForType(item.type)}
          </Box>
          <Text
            fontSize="13px"
            color="fg"
            flex={1}
            minWidth={0}
            lineClamp={1}
            title={item.name}
          >
            {item.name}
          </Text>
          <Text
            fontFamily="mono"
            fontSize="11px"
            color="fg.subtle"
            flexShrink={0}
          >
            {getLabelForType(item.type)}
          </Text>
          {timeAgo ? (
            <Text
              fontFamily="mono"
              fontSize="11px"
              color="fg.subtle"
              flexShrink={0}
              minWidth="56px"
              textAlign="right"
            >
              {timeAgo}
            </Text>
          ) : null}
        </HStack>
      </NextLink>
    </ChakraLink>
  );
}

/**
 * Loading skeleton mirroring the list rows, so content fills in place.
 */
function RecentItemsSkeleton() {
  return (
    <HomeCard cursor="default" padding={2}>
      <VStack align="stretch" gap={1} width="full">
        {Array.from({ length: 4 }).map((_, i) => (
          <HStack key={i} gap={2.5} paddingX={2.5} paddingY="7px">
            <Skeleton width="28px" height="28px" borderRadius="md" />
            <Skeleton height="13px" flex={1} maxWidth="45%" />
            <Skeleton height="11px" width="56px" />
          </HStack>
        ))}
      </VStack>
    </HomeCard>
  );
}

/**
 * RecentItemsSection
 * Recently touched items as one dense list. `priorityTypes` floats the given
 * entity types to the front without hiding the rest.
 */
export function RecentItemsSection({
  priorityTypes,
}: {
  priorityTypes?: RecentItemType[];
} = {}) {
  const { project } = useOrganizationTeamProject();

  const {
    data: fetchedItems,
    isLoading,
    error,
    refetch,
  } = api.home.getRecentItems.useQuery(
    { projectId: project?.id ?? "", limit: 12 },
    {
      enabled: !!project?.id,
      // Same cache policy as the briefing (which shares this exact query
      // key): paint instantly from cache, refresh quietly in the background —
      // the section shouldn't sit in a skeleton for ages on every visit.
      staleTime: 60_000,
      cacheTime: 10 * 60_000,
      keepPreviousData: true,
    },
  );

  const recentItems =
    fetchedItems && priorityTypes?.length
      ? [
          ...fetchedItems.filter((i) => priorityTypes.includes(i.type)),
          ...fetchedItems.filter((i) => !priorityTypes.includes(i.type)),
        ]
      : fetchedItems;

  if (!isLoading && !error && recentItems?.length === 0) {
    return null;
  }

  return (
    <VStack align="stretch" gap={HOME_SECTION_GAP} width="full">
      <HomeSectionHeader title="Jump right back" />

      {/* Only a real in-flight fetch earns a skeleton — a disabled query
          (project still resolving) reports isLoading without ever fetching. */}
      {isLoading && !!project?.id && <RecentItemsSkeleton />}

      {error && (
        <HomeCard cursor="default" padding={6}>
          <VStack gap={2} width="full">
            <Box color="red.500">
              <LuCircleX size={24} />
            </Box>
            <Text fontSize="sm" color="fg.muted">
              Failed to load recent items
            </Text>
            <Text
              fontSize="xs"
              color="blue.500"
              cursor="pointer"
              _hover={{ textDecoration: "underline" }}
              onClick={() => void refetch()}
            >
              Retry
            </Text>
          </VStack>
        </HomeCard>
      )}

      {!isLoading && !error && recentItems && recentItems.length > 0 && (
        <HomeCard cursor="default" padding={2}>
          <VStack align="stretch" gap={0.5} width="full">
            {recentItems.slice(0, MAX_RECENT_ROWS).map((item) => (
              <RecentItemRow key={`${item.type}-${item.id}`} item={item} />
            ))}
          </VStack>
        </HomeCard>
      )}
    </VStack>
  );
}
