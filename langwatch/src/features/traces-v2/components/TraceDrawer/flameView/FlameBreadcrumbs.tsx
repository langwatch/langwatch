import { Flex, HStack, Icon, Text } from "@chakra-ui/react";
import { LuChevronRight, LuRotateCcw } from "react-icons/lu";
import { Kbd } from "~/components/ops/shared/Kbd";
import { Tooltip } from "~/components/ui/tooltip";
import { formatDuration } from "../../../utils/formatters";
import { formatPercent } from "./tree";
import type { FlameNode } from "./types";

interface FlameBreadcrumbsProps {
  breadcrumbs: FlameNode[];
  isZoomed: boolean;
  onResetZoom: () => void;
  onSpanDoubleClick: (spanId: string) => void;
}

/**
 * Ancestor breadcrumb chain + reset-zoom button shown at the top of the
 * flame view when a span is focused or the viewport is zoomed in.
 */
export function FlameBreadcrumbs({
  breadcrumbs,
  isZoomed,
  onResetZoom,
  onSpanDoubleClick,
}: FlameBreadcrumbsProps) {
  return (
    <Flex
      align="center"
      justify="space-between"
      gap={2}
      paddingX={3}
      paddingY={1.5}
      flexShrink={0}
    >
      <HStack gap={0.5} flexWrap="nowrap" overflow="hidden" minWidth={0}>
        <Text
          as="button"
          textStyle="xs"
          color="fg.subtle"
          cursor="pointer"
          _hover={{ color: "fg" }}
          onClick={onResetZoom}
          flexShrink={0}
        >
          root
        </Text>
        {breadcrumbs.map((node, i) => {
          const isLast = i === breadcrumbs.length - 1;
          const crumbDur = node.span.endTimeMs - node.span.startTimeMs;
          const parentDur = node.parent
            ? node.parent.span.endTimeMs - node.parent.span.startTimeMs
            : null;
          const pctOfParent =
            parentDur !== null && parentDur > 0
              ? (crumbDur / parentDur) * 100
              : null;
          return (
            <HStack key={node.span.spanId} gap={0} minWidth={0}>
              <Icon as={LuChevronRight} boxSize={3} color="fg.subtle" />
              <HStack
                as="button"
                gap={1}
                paddingX={1}
                paddingY={0.5}
                borderRadius="sm"
                cursor={isLast ? "default" : "pointer"}
                _hover={isLast ? undefined : { bg: "bg.muted" }}
                onClick={() =>
                  !isLast && onSpanDoubleClick(node.span.spanId)
                }
              >
                <Text
                  textStyle="xs"
                  color={isLast ? "fg" : "fg.muted"}
                  fontWeight={isLast ? "medium" : "normal"}
                  truncate
                  maxWidth="200px"
                >
                  {node.span.name}
                </Text>
                <Text textStyle="xs" color="fg.subtle" whiteSpace="nowrap">
                  {formatDuration(crumbDur)}
                  {pctOfParent !== null
                    ? ` · ${formatPercent(pctOfParent)}`
                    : ""}
                </Text>
              </HStack>
            </HStack>
          );
        })}
      </HStack>
      {isZoomed && (
        <Tooltip
          content={
            <HStack gap={1}>
              <Text>Reset zoom</Text>
              <Kbd>Esc</Kbd>
            </HStack>
          }
          positioning={{ placement: "top" }}
        >
          <Flex
            as="button"
            align="center"
            gap={1}
            paddingX={2}
            paddingY={0.5}
            borderRadius="sm"
            cursor="pointer"
            color="fg.muted"
            _hover={{ bg: "bg.muted", color: "fg" }}
            onClick={onResetZoom}
            flexShrink={0}
          >
            <Icon as={LuRotateCcw} boxSize={3} />
            <Text textStyle="xs">Reset</Text>
          </Flex>
        </Tooltip>
      )}
    </Flex>
  );
}
