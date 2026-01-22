/**
 * ExpandableDatasetCell - A cell that can expand to show full content.
 *
 * Used for dataset columns in the batch results table.
 * Simpler version of BatchTargetCell without evaluator chips and trace buttons.
 */

import { Box, Button, HStack, Portal, Text, VStack } from "@chakra-ui/react";
import { useCallback, useRef, useState } from "react";
import { LuCheck, LuCopy } from "react-icons/lu";

import { Tooltip } from "~/components/ui/tooltip";

// Max characters to display for performance
const MAX_DISPLAY_CHARS = 10000;

// Max height for collapsed output - used in CSS
const CELL_MAX_HEIGHT = 180;

// Approximate chars that fit in the cell before overflow (rough heuristic)
// This avoids needing useEffect for overflow detection which causes flicker
const OVERFLOW_CHAR_THRESHOLD = 150;

type ExpandableDatasetCellProps = {
  /** The value to display */
  value: unknown;
  /** Optional column name for test IDs */
  columnName?: string;
};

/**
 * Stringify value for display.
 */
const stringify = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
};

export function ExpandableDatasetCell({
  value,
  columnName = "dataset",
}: ExpandableDatasetCellProps) {
  // State for expanded view
  const [isExpanded, setIsExpanded] = useState(false);
  const [hasCopied, setHasCopied] = useState(false);
  const cellRef = useRef<HTMLDivElement>(null);
  const [expandedPosition, setExpandedPosition] = useState({
    top: 0,
    left: 0,
    width: 0,
  });

  const rawContent = stringify(value);

  // Use a simple heuristic to determine if content likely overflows
  // This avoids useEffect + scrollHeight measurement which causes flicker during virtualization
  const hasNewlines = rawContent.includes("\n");
  const isLikelyOverflowing =
    rawContent.length > OVERFLOW_CHAR_THRESHOLD || hasNewlines;

  // Handler to expand
  const handleExpand = useCallback(() => {
    if (cellRef.current) {
      // Use the cell ref's own position (works correctly in diff mode where multiple
      // values share the same td, each value should expand from its own position)
      const rect = cellRef.current.getBoundingClientRect();
      // Also get the td width to use as min width
      const td = cellRef.current.closest("td");
      const tdWidth = td?.getBoundingClientRect().width ?? rect.width;

      const expandedWidth = Math.max(rect.width, tdWidth) + 24;
      const safetyMargin = 32;
      const viewportWidth = window.innerWidth;

      // Adjust left position if it would overflow the viewport
      let left = rect.left - 12;
      if (left + expandedWidth > viewportWidth - safetyMargin) {
        left = viewportWidth - expandedWidth - safetyMargin;
      }

      setExpandedPosition({
        top: rect.top,
        left,
        width: expandedWidth,
      });
    }
    setIsExpanded(true);
  }, []);

  // Handler to close expanded
  const handleClose = useCallback(() => {
    setIsExpanded(false);
  }, []);

  // Copy to clipboard
  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(rawContent);
    setHasCopied(true);
    setTimeout(() => setHasCopied(false), 2000);
  }, [rawContent]);

  // Truncate if too long
  const isTruncated = rawContent.length > MAX_DISPLAY_CHARS;
  const displayContent = isTruncated
    ? rawContent.slice(0, MAX_DISPLAY_CHARS)
    : rawContent;

  // Empty state
  if (!rawContent) {
    return (
      <Text fontSize="13px" color="fg.subtle">
        -
      </Text>
    );
  }

  // Render content
  const renderContent = (expanded: boolean) => {
    if (expanded) {
      return (
        <Box flex={1} overflowY="auto" minHeight={0}>
          <Text fontSize="13px" whiteSpace="pre-wrap" wordBreak="break-word">
            {displayContent}
            {isTruncated && (
              <Box as="span" color="fg.subtle" fontSize="11px" marginLeft={1}>
                (truncated)
              </Box>
            )}
          </Text>
        </Box>
      );
    }

    // Collapsed view with fade
    return (
      <Box position="relative">
        <Box
          maxHeight={`${CELL_MAX_HEIGHT}px`}
          overflow="hidden"
          cursor={isLikelyOverflowing ? "pointer" : undefined}
          onClick={isLikelyOverflowing ? handleExpand : undefined}
        >
          <Text fontSize="13px" whiteSpace="pre-wrap" wordBreak="break-word">
            {displayContent}
            {isTruncated && (
              <Box as="span" color="fg.subtle" fontSize="11px" marginLeft={1}>
                (truncated)
              </Box>
            )}
          </Text>
        </Box>

        {/* Fade overlay for overflowing content - shown based on heuristic to avoid flicker */}
        {isLikelyOverflowing && (
          <Box
            position="absolute"
            bottom={0}
            left="-12px"
            right="-12px"
            height="40px"
            cursor="pointer"
            onClick={handleExpand}
            className="cell-fade-overlay"
            css={{
              background: "linear-gradient(to bottom, transparent, white)",
              "tr:hover &": {
                background:
                  "linear-gradient(to bottom, transparent, var(--chakra-colors-gray-50))",
              },
            }}
          />
        )}
      </Box>
    );
  };

  // Render copy button
  const renderCopyButton = (inExpandedView: boolean) => (
    <HStack
      position="absolute"
      top={-1}
      right={-1}
      gap={0.5}
      zIndex={1}
      className={inExpandedView ? undefined : "cell-action-btn"}
      opacity={inExpandedView ? 1 : 0}
      transition="opacity 0.15s"
      bg="gray.50/90"
      borderRadius="md"
      px={0.5}
    >
      <Tooltip
        content={hasCopied ? "Copied!" : "Copy to clipboard"}
        positioning={{ placement: "top" }}
        openDelay={100}
      >
        <Button
          size="xs"
          variant="ghost"
          _hover={{ bg: "gray.200" }}
          onClick={(e) => {
            e.stopPropagation();
            handleCopy();
          }}
          data-testid={`copy-${columnName}`}
        >
          {hasCopied ? <LuCheck /> : <LuCopy />}
        </Button>
      </Tooltip>
    </HStack>
  );

  return (
    <>
      {/* Normal collapsed view */}
      <Box
        ref={cellRef}
        position="relative"
        css={{ "&:hover .cell-action-btn": { opacity: 1 } }}
      >
        <VStack align="stretch" height="100%" gap={0}>
          {renderCopyButton(false)}
          {renderContent(false)}
        </VStack>
      </Box>

      {/* Expanded overlay */}
      {isExpanded && (
        <Portal>
          {/* Invisible backdrop to catch clicks outside */}
          <Box
            position="fixed"
            inset={0}
            zIndex={1000}
            onClick={handleClose}
            data-testid={`expanded-${columnName}-backdrop`}
          />
          {/* Expanded content */}
          <Box
            position="fixed"
            top={`${expandedPosition.top - 12}px`}
            left={`${expandedPosition.left}px`}
            width={`${Math.max(expandedPosition.width, 250)}px`}
            maxHeight={`calc(100vh - ${expandedPosition.top - 12}px - 32px)`}
            overflowY="auto"
            bg="white/75"
            backdropFilter="blur(8px)"
            borderRadius="md"
            boxShadow="0 0 0 2px var(--chakra-colors-gray-300), 0 4px 12px rgba(0,0,0,0.15)"
            zIndex={1001}
            display="flex"
            flexDirection="column"
            p={3}
            css={{
              animation: "scale-in 0.15s ease-out",
            }}
          >
            <VStack align="stretch" gap={0} height="100%" position="relative">
              {renderCopyButton(true)}
              {renderContent(true)}
            </VStack>
          </Box>
        </Portal>
      )}
    </>
  );
}
