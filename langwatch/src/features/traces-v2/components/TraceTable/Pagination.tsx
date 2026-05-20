import {
  Button,
  Flex,
  IconButton,
  Skeleton,
  Spacer,
  Text,
} from "@chakra-ui/react";
import { ChevronLeft, ChevronRight, PanelLeftOpen } from "lucide-react";
import type React from "react";
import { Tooltip } from "~/components/ui/tooltip";
import { useFilterStore } from "../../stores/filterStore";
import { useUIStore } from "../../stores/uiStore";

const PAGE_SIZE_OPTIONS = [25, 50, 100, 250, 500, 1000] as const;

interface PaginationProps {
  totalHits: number;
  /**
   * Renders a placeholder bar in place of the rows-per-page selector +
   * "Page X of Y" copy while data is loading, so the pagination row
   * doesn't pop in when the first page resolves. Back/forward arrows
   * keep rendering — their disabled state doesn't change between
   * loading and loaded for the initial page, and they anchor the
   * visual end of the row.
   */
  isLoading?: boolean;
}

export const Pagination: React.FC<PaginationProps> = ({
  totalHits,
  isLoading = false,
}) => {
  const page = useFilterStore((s) => s.page);
  const pageSize = useFilterStore((s) => s.pageSize);
  const setPage = useFilterStore((s) => s.setPage);
  const setPageSize = useFilterStore((s) => s.setPageSize);
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);

  const totalPages = Math.max(1, Math.ceil(totalHits / pageSize));

  // When the sidebar is collapsed it disappears from the page entirely
  // (no rail, no icon strip), so the "expand" affordance hops down here
  // — anchored on the left of the footer where it stays visible no
  // matter how many rows or filters are in play. Without this the
  // operator would have no way back from a collapsed sidebar besides
  // the keyboard shortcut.
  const showExpandButton = sidebarCollapsed;

  // The pagination row would normally hide on an empty result set —
  // suppress that when the expand button needs to stay reachable, else
  // a user who collapses the sidebar and then filters down to nothing
  // is stuck with the rail gone too.
  if (!isLoading && totalHits === 0 && !showExpandButton) return null;

  return (
    <Flex
      align="center"
      gap={3}
      paddingX={2}
      paddingY={1.5}
      borderTopWidth="1px"
      borderColor="border.muted"
      bg="bg.surface"
      flexShrink={0}
    >
      {showExpandButton && (
        <Tooltip
          content="Show filters sidebar"
          positioning={{ placement: "top" }}
        >
          <IconButton
            aria-label="Show filters sidebar"
            variant="ghost"
            size="2xs"
            color="fg.subtle"
            onClick={toggleSidebar}
          >
            <PanelLeftOpen size={14} />
          </IconButton>
        </Tooltip>
      )}
      <Spacer />
      {isLoading ? (
        <Skeleton height="14px" width="240px" borderRadius="sm" />
      ) : (
        totalHits > 0 && (
          <>
            <Flex align="center" gap={0.5}>
              <Text textStyle="xs" color="fg.subtle" flexShrink={0}>
                Rows
              </Text>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <Button
                  key={size}
                  variant="ghost"
                  size="2xs"
                  color={pageSize === size ? "fg" : "fg.subtle"}
                  fontWeight={pageSize === size ? "semibold" : "normal"}
                  onClick={() => setPageSize(size)}
                  paddingX={1.5}
                  minWidth="auto"
                >
                  {size}
                </Button>
              ))}
            </Flex>
            <Text textStyle="xs" color="fg.subtle">
              Page {page} of {totalPages} ({totalHits} traces)
            </Text>
          </>
        )
      )}
      {totalHits > 0 && (
        <Flex gap={1}>
          <IconButton
            aria-label="Previous page"
            variant="ghost"
            size="xs"
            disabled={isLoading || page <= 1}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft size={12} />
          </IconButton>
          <IconButton
            aria-label="Next page"
            variant="ghost"
            size="xs"
            disabled={isLoading || page >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRight size={12} />
          </IconButton>
        </Flex>
      )}
    </Flex>
  );
};
