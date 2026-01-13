/**
 * ExpandableDatasetCell - A cell that can expand to show full content.
 *
 * Used for dataset columns in the batch results table.
 * Simpler version of BatchTargetCell without evaluator chips and trace buttons.
 */
import { useCallback, useState, useRef, useEffect } from "react";
import { Box, Button, HStack, Portal, Text, VStack } from "@chakra-ui/react";
import { LuCopy, LuCheck } from "react-icons/lu";

import { Tooltip } from "~/components/ui/tooltip";

// Max characters to display for performance
const MAX_DISPLAY_CHARS = 10000;

// Max height for collapsed output
const CELL_MAX_HEIGHT = 100;

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
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [hasCopied, setHasCopied] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const cellRef = useRef<HTMLDivElement>(null);
  const [expandedPosition, setExpandedPosition] = useState({
    top: 0,
    left: 0,
    width: 0,
  });

  const rawContent = stringify(value);

  // Check if content overflows
  useEffect(() => {
    if (contentRef.current) {
      const isContentOverflowing = contentRef.current.scrollHeight > CELL_MAX_HEIGHT;
      setIsOverflowing(isContentOverflowing);
    }
  }, [rawContent]);

  // Handler to expand
  const handleExpand = useCallback(() => {
    if (cellRef.current) {
      const td = cellRef.current.closest("td");
      if (td) {
        const rect = td.getBoundingClientRect();
        setExpandedPosition({
          top: rect.top,
          left: rect.left,
          width: rect.width,
        });
      }
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
      <Text fontSize="13px" color="gray.400">
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
              <Box as="span" color="gray.400" fontSize="11px" marginLeft={1}>
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
          ref={contentRef}
          maxHeight={`${CELL_MAX_HEIGHT}px`}
          overflow="hidden"
          cursor={isOverflowing ? "pointer" : undefined}
          onClick={isOverflowing ? handleExpand : undefined}
        >
          <Text fontSize="13px" whiteSpace="pre-wrap" wordBreak="break-word">
            {displayContent}
            {isTruncated && (
              <Box as="span" color="gray.400" fontSize="11px" marginLeft={1}>
                (truncated)
              </Box>
            )}
          </Text>
        </Box>

        {/* Fade overlay for overflowing content */}
        {isOverflowing && (
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
              background:
                "linear-gradient(to bottom, transparent, white)",
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
        <VStack align="stretch" gap={0}>
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
            top={`${expandedPosition.top - 8}px`}
            left={`${expandedPosition.left - 8}px`}
            width={`${Math.max(expandedPosition.width + 16, 250)}px`}
            maxHeight="calc(100vh - 32px)"
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
