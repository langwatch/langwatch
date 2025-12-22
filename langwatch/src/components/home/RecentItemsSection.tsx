import {
  Box,
  EmptyState,
  Grid,
  Heading,
  HStack,
  Skeleton,
  Spacer,
  Tabs,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  LuCircleX,
  LuBookOpen,
  LuDatabase,
  LuGauge,
  LuMessageSquare,
  LuPlay,
  LuScroll,
  LuWorkflow,
} from "react-icons/lu";
import { useRouter } from "next/router";
import type { ReactNode } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { RecentItem, RecentItemType } from "~/server/home/types";
import { api } from "~/utils/api";
import { formatTimeAgo } from "~/utils/formatTimeAgo";
import { HomeCard } from "./HomeCard";

/**
 * Get icon for entity type
 */
const getIconForType = (type: RecentItemType): ReactNode => {
  const iconProps = { size: 14 };
  switch (type) {
    case "prompt":
      return <LuScroll {...iconProps} />;
    case "workflow":
      return <LuWorkflow {...iconProps} />;
    case "dataset":
      return <LuDatabase {...iconProps} />;
    case "evaluation":
      return <LuGauge {...iconProps} />;
    case "annotation":
      return <LuMessageSquare {...iconProps} />;
    case "simulation":
      return <LuPlay {...iconProps} />;
    default:
      return <LuBookOpen {...iconProps} />;
  }
};

/**
 * Get color for entity type
 */
const getColorForType = (type: RecentItemType): string => {
  switch (type) {
    case "prompt":
      return "purple.500";
    case "workflow":
      return "blue.500";
    case "dataset":
      return "green.500";
    case "evaluation":
      return "orange.500";
    case "annotation":
      return "cyan.500";
    case "simulation":
      return "pink.500";
    default:
      return "gray.500";
  }
};

/**
 * Get label for entity type
 */
const getLabelForType = (type: RecentItemType): string => {
  switch (type) {
    case "prompt":
      return "Prompt";
    case "workflow":
      return "Workflow";
    case "dataset":
      return "Dataset";
    case "evaluation":
      return "Evaluation";
    case "annotation":
      return "Annotation";
    case "simulation":
      return "Simulation";
    default:
      return "Item";
  }
};

/**
 * Group items by type for "By type" tab
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

type RecentItemCardProps = {
  item: RecentItem;
  onClick: () => void;
};

/**
 * Card for a single recent item
 */
function RecentItemCard({ item, onClick }: RecentItemCardProps) {
  const timeAgo = formatTimeAgo(item.updatedAt.getTime());
  const color = getColorForType(item.type);
  const icon = getIconForType(item.type);

  return (
    <HomeCard padding={3} onClick={onClick}>
      <HStack gap={2} align="start" width="full">
        <Box
          padding={1.5}
          borderRadius="md"
          background={`${color.split(".")[0]}.50`}
          color={color}
        >
          {icon}
        </Box>
        <VStack align="start" gap={0} flex={1} minWidth={0}>
          <Text fontSize="sm" lineClamp={1} title={item.name}>
            {item.name}
          </Text>
          <HStack gap={2}>
            <Text fontSize="xs" color="gray.500">
              {getLabelForType(item.type)}
            </Text>
            {timeAgo && (
              <>
                <Text fontSize="xs" color="gray.400">
                  •
                </Text>
                <Text fontSize="xs" color="gray.500">
                  {timeAgo}
                </Text>
              </>
            )}
          </HStack>
        </VStack>
      </HStack>
    </HomeCard>
  );
}

/**
 * Loading skeleton for recent items
 */
function RecentItemsSkeleton() {
  return (
    <Grid
      templateColumns={{
        base: "1fr",
        md: "repeat(2, 1fr)",
        lg: "repeat(3, 1fr)",
      }}
      gap={3}
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <HomeCard key={i} cursor="default" padding={3}>
          <HStack gap={2}>
            <Skeleton width="32px" height="32px" borderRadius="md" />
            <VStack align="start" gap={1} flex={1}>
              <Skeleton height="14px" width="80%" />
              <Skeleton height="12px" width="50%" />
            </VStack>
          </HStack>
        </HomeCard>
      ))}
    </Grid>
  );
}

/**
 * Empty state when no recent items
 */
function RecentItemsEmptyState() {
  return (
    <EmptyState.Root size="sm">
      <EmptyState.Content>
        <EmptyState.Indicator>
          <LuBookOpen />
        </EmptyState.Indicator>
        <VStack textAlign="center">
          <EmptyState.Title fontSize="sm">No recent activity</EmptyState.Title>
          <EmptyState.Description fontSize="xs">
            Items you work on will appear here for quick access
          </EmptyState.Description>
        </VStack>
      </EmptyState.Content>
    </EmptyState.Root>
  );
}

/**
 * Grid of recent items
 */
function RecentItemsGrid({ items }: { items: RecentItem[] }) {
  const router = useRouter();

  const handleItemClick = (item: RecentItem) => {
    void router.push(item.href);
  };

  return (
    <Grid
      templateColumns={{
        base: "1fr",
        md: "repeat(2, 1fr)",
        lg: "repeat(3, 1fr)",
      }}
      gap={3}
    >
      {items.map((item) => (
        <RecentItemCard
          key={`${item.type}-${item.id}`}
          item={item}
          onClick={() => handleItemClick(item)}
        />
      ))}
    </Grid>
  );
}

/**
 * Grouped view for "By type" tab
 */
function GroupedItemsView({ items }: { items: RecentItem[] }) {
  const router = useRouter();
  const grouped = groupItemsByType(items);

  const handleItemClick = (item: RecentItem) => {
    void router.push(item.href);
  };

  return (
    <VStack gap={4} align="stretch">
      {Array.from(grouped.entries()).map(([type, typeItems]) => (
        <VStack key={type} align="stretch" gap={2}>
          <HStack>
            <Box color={getColorForType(type)}>{getIconForType(type)}</Box>
            <Text fontSize="sm" color="gray.700">
              {getLabelForType(type)}s
            </Text>
            <Text fontSize="xs" color="gray.500">
              ({typeItems.length})
            </Text>
          </HStack>
          <Grid
            templateColumns={{
              base: "1fr",
              md: "repeat(2, 1fr)",
              lg: "repeat(3, 1fr)",
            }}
            gap={3}
          >
            {typeItems.map((item) => (
              <RecentItemCard
                key={`${item.type}-${item.id}`}
                item={item}
                onClick={() => handleItemClick(item)}
              />
            ))}
          </Grid>
        </VStack>
      ))}
    </VStack>
  );
}

/**
 * RecentItemsSection
 * Displays recently accessed items on the home page.
 */
export function RecentItemsSection() {
  const { project } = useOrganizationTeamProject();

  const {
    data: recentItems,
    isLoading,
    error,
    refetch,
  } = api.home.getRecentItems.useQuery(
    { projectId: project?.id ?? "", limit: 12 },
    { enabled: !!project?.id },
  );

  if (!isLoading && !error && recentItems?.length === 0) {
    return null;
  }

  return (
    <VStack align="stretch" gap={3} width="full">
      <Tabs.Root
        defaultValue="recents"
        variant="enclosed"
        size="sm"
        border="none"
        width="full"
      >
        <HStack width="full">
          <Heading>Jump right back</Heading>
          <Spacer />
          <Tabs.List border="none">
            <Tabs.Trigger value="recents" fontSize="xs" paddingX={2} paddingY={0.5}>Recents</Tabs.Trigger>
            <Tabs.Trigger value="by-type" whiteSpace="nowrap" fontSize="xs" paddingX={2} paddingY={0.5}>
              By type
            </Tabs.Trigger>
          </Tabs.List>
        </HStack>

        {isLoading && <RecentItemsSkeleton />}

        {error && (
          <HomeCard cursor="default" padding={6}>
            <VStack gap={2} width="full">
              <Box color="red.500">
                <LuCircleX size={24} />
              </Box>
              <Text fontSize="sm" color="gray.600">
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
          <>
            <Tabs.Content value="recents" paddingTop={3}>
              <RecentItemsGrid items={recentItems} />
            </Tabs.Content>
            <Tabs.Content value="by-type" paddingTop={3}>
              <GroupedItemsView items={recentItems} />
            </Tabs.Content>
          </>
        )}
      </Tabs.Root>
    </VStack>
  );
}
