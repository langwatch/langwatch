import { Button, Circle, Flex, HStack, Icon, Text } from "@chakra-ui/react";
import { LuPin, LuPinOff, LuX } from "react-icons/lu";
import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";
import type { DrawerTab } from "../../stores/drawerStore";
import {
  abbreviateModel,
  formatDuration,
  SPAN_TYPE_COLORS,
  truncateId,
} from "../../utils/formatters";
import { Tooltip } from "~/components/ui/tooltip";
import { Kbd } from "~/components/ops/shared/Kbd";

interface SpanTabBarProps {
  activeTab: DrawerTab;
  onTabChange: (tab: DrawerTab) => void;
  selectedSpan: SpanTreeNode | null;
  onCloseSpanTab: () => void;
  pinnedSpans: SpanTreeNode[];
  onSelectSpan: (spanId: string) => void;
  onPinSpan: (spanId: string) => void;
  onUnpinSpan: (spanId: string) => void;
}

export function SpanTabBar({
  activeTab,
  onTabChange,
  selectedSpan,
  onCloseSpanTab,
  pinnedSpans,
  onSelectSpan,
  onPinSpan,
  onUnpinSpan,
}: SpanTabBarProps) {
  const isSelectedPinned = selectedSpan
    ? pinnedSpans.some((s) => s.spanId === selectedSpan.spanId)
    : false;

  return (
    <HStack
      gap="5px"
      paddingX={4}
      borderBottomWidth="1px"
      borderColor="border"
      overflowX="auto"
      flexShrink={0}
      css={{ "&::-webkit-scrollbar": { display: "none" } }}
    >
      <Tooltip
        content={
          <HStack gap={1}>
            <Text>Show trace summary</Text>
            <Kbd>O</Kbd>
          </HStack>
        }
        positioning={{ placement: "bottom" }}
      >
        <Button
          size="sm"
          variant="ghost"
          borderRadius={0}
          borderBottomWidth="2px"
          borderBottomColor={
            activeTab === "summary" ? "blue.solid" : "transparent"
          }
          color={activeTab === "summary" ? "fg" : "fg.muted"}
          fontWeight={activeTab === "summary" ? "semibold" : "medium"}
          onClick={() => onTabChange("summary")}
          paddingX={3}
          paddingY={2}
          flexShrink={0}
          gap={1.5}
        >
          Trace Summary
          <Kbd>O</Kbd>
        </Button>
      </Tooltip>

      {/* Pinned span tabs */}
      {pinnedSpans.map((span) => {
        const isActive =
          activeTab === "span" && selectedSpan?.spanId === span.spanId;
        return (
          <SpanTab
            key={span.spanId}
            span={span}
            isActive={isActive}
            onClick={() => onSelectSpan(span.spanId)}
            actionIcon={<Icon as={LuPinOff} boxSize={3} />}
            actionLabel="Unpin span tab"
            onAction={() => onUnpinSpan(span.spanId)}
          />
        );
      })}

      {/* Ephemeral span tab — only if selected span is not pinned */}
      {selectedSpan && !isSelectedPinned && (
        <SpanTab
          span={selectedSpan}
          isActive={activeTab === "span"}
          onClick={() => onTabChange("span")}
          actionIcon={<Icon as={LuPin} boxSize={3} />}
          actionLabel="Pin span tab"
          onAction={() => onPinSpan(selectedSpan.spanId)}
          secondaryActionIcon={<Icon as={LuX} boxSize={3} />}
          secondaryActionLabel="Close span tab"
          onSecondaryAction={onCloseSpanTab}
        />
      )}
    </HStack>
  );
}

interface SpanTabProps {
  span: SpanTreeNode;
  isActive: boolean;
  onClick: () => void;
  actionIcon: React.ReactNode;
  actionLabel: string;
  onAction: () => void;
  secondaryActionIcon?: React.ReactNode;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
}

function SpanTab({
  span,
  isActive,
  onClick,
  actionIcon,
  actionLabel,
  onAction,
  secondaryActionIcon,
  secondaryActionLabel,
  onSecondaryAction,
}: SpanTabProps) {
  const activeBorderColor =
    (SPAN_TYPE_COLORS[span.type ?? "span"] as string) ?? "gray.solid";
  return (
    <HStack
      gap={1}
      paddingX={3}
      paddingY={2}
      flexShrink={0}
      borderRadius={0}
      borderBottomWidth="2px"
      borderBottomColor={isActive ? activeBorderColor : "transparent"}
      color={isActive ? "fg" : "fg.muted"}
      fontWeight={isActive ? "semibold" : "normal"}
      cursor="pointer"
      onClick={onClick}
      _hover={{ bg: "bg.muted", color: "fg" }}
      transition="background 0.12s ease, color 0.12s ease"
    >
      <SpanTypeBadge type={span.type ?? "span"} />
      <Text
        textStyle="xs"
        color="inherit"
        fontWeight="inherit"
        maxWidth="160px"
        truncate
        fontFamily="mono"
      >
        {span.name}
      </Text>

      <Tooltip content={span.spanId} positioning={{ placement: "top" }}>
        <Text textStyle="xs" color="fg.subtle" fontFamily="mono">
          {truncateId(span.spanId)}
        </Text>
      </Tooltip>

      <Text textStyle="xs" color="fg.subtle">
        {formatDuration(span.durationMs)}
      </Text>

      {span.type === "llm" && span.model != null && (
        <Text textStyle="xs" color="fg.subtle" fontFamily="mono">
          {abbreviateModel(span.model)}
        </Text>
      )}

      {span.status === "error" && (
        <Circle size="6px" bg="red.solid" flexShrink={0} />
      )}

      <Tooltip content={actionLabel} positioning={{ placement: "top" }}>
        <Flex
          as="button"
          align="center"
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            onAction();
          }}
          aria-label={actionLabel}
          color="fg.subtle"
          paddingX={1.5}
          paddingY={1}
          borderRadius="sm"
          _hover={{ color: "fg", bg: "bg.emphasized" }}
        >
          {actionIcon}
        </Flex>
      </Tooltip>

      {secondaryActionIcon && onSecondaryAction && (
        <Tooltip content={secondaryActionLabel ?? ""} positioning={{ placement: "top" }}>
          <Flex
            as="button"
            align="center"
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              onSecondaryAction();
            }}
            aria-label={secondaryActionLabel}
            color="fg.subtle"
            paddingX={1}
            borderRadius="sm"
            _hover={{ color: "fg", bg: "bg.emphasized" }}
          >
            {secondaryActionIcon}
          </Flex>
        </Tooltip>
      )}
    </HStack>
  );
}

function SpanTypeBadge({ type }: { type: string }) {
  const color = (SPAN_TYPE_COLORS[type] as string) ?? "gray.solid";
  const label = type.toUpperCase();

  return (
    <Text
      textStyle="2xs"
      fontWeight="semibold"
      color={color}
      paddingX={1.5}
      paddingY={0}
      borderRadius="sm"
      borderWidth="1px"
      borderColor={color}
    >
      {label}
    </Text>
  );
}
