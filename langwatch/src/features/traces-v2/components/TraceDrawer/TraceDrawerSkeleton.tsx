import { Box, Button, HStack, Icon, Skeleton, VStack } from "@chakra-ui/react";
import { LuX } from "react-icons/lu";
import { Tooltip } from "~/components/ui/tooltip";

interface TraceDrawerSkeletonProps {
  onClose: () => void;
}

/**
 * Layout-mirroring skeleton for the trace drawer. Mirrors the real
 * `DrawerHeader` + viz + tab-bar + accordion structure so the loading state
 * doesn't reflow the panel when content arrives, and so the close affordance
 * stays clickable while the trace fetches.
 */
export function TraceDrawerSkeleton({ onClose }: TraceDrawerSkeletonProps) {
  return (
    <VStack align="stretch" gap={0} flex={1} minHeight={0}>
      {/* Header — same VStack rhythm as DrawerHeader so swap-in is silent. */}
      <VStack align="stretch" gap={2} paddingX={4} paddingTop={3}>
        {/* Row 1: type badge · title · status — actions including close on right. */}
        <HStack justify="space-between" align="center" gap={2.5} minWidth={0}>
          <HStack gap={2.5} flex={1} minWidth={0}>
            <Skeleton height="18px" width="44px" borderRadius="sm" />
            <Skeleton height="20px" width="55%" borderRadius="md" />
            <Skeleton height="8px" width="8px" borderRadius="full" />
          </HStack>
          <HStack gap={1} flexShrink={0}>
            <Skeleton height="24px" width="24px" borderRadius="md" />
            <Skeleton height="24px" width="24px" borderRadius="md" />
            <Skeleton height="24px" width="24px" borderRadius="md" />
            <Box
              width="1px"
              height="16px"
              bg="border.muted"
              marginX={0.5}
              flexShrink={0}
            />
            <Tooltip content="Close" positioning={{ placement: "bottom" }}>
              <Button
                size="xs"
                variant="ghost"
                onClick={onClose}
                aria-label="Close drawer"
                paddingX={3}
                minWidth="auto"
                color="fg.muted"
                _hover={{ bg: "bg.muted", color: "fg" }}
                _active={{ bg: "bg.emphasized" }}
              >
                <Icon as={LuX} boxSize={5} strokeWidth={2.25} />
              </Button>
            </Tooltip>
          </HStack>
        </HStack>

        {/* Row 2: metric pills (Duration / Spans / TTFT / Cost / Tokens / Model). */}
        <HStack gap={1.5} flexWrap="wrap" align="center">
          {[88, 70, 78, 80, 110, 96].map((w, i) => (
            <Skeleton
              key={`metric-${i}`}
              height="22px"
              width={`${w}px`}
              borderRadius="md"
            />
          ))}
        </HStack>

        {/* Row 3: chip / pin strip. */}
        <HStack gap={1.5} flexWrap="wrap" align="center">
          {[120, 92, 144, 100].map((w, i) => (
            <Skeleton
              key={`chip-${i}`}
              height="22px"
              width={`${w}px`}
              borderRadius="md"
            />
          ))}
        </HStack>

        {/* Row 4: mode switch (Trace / Conversation tabs + trailing meta). */}
        <Box marginX={-4}>
          <HStack
            paddingX={4}
            paddingTop={2}
            paddingBottom={1}
            justify="space-between"
            align="center"
          >
            <HStack gap={5}>
              <Skeleton height="20px" width="56px" />
              <Skeleton height="20px" width="110px" />
            </HStack>
            <Skeleton height="14px" width="84px" />
          </HStack>
        </Box>
      </VStack>

      <Box borderBottomWidth="1px" borderColor="border" />

      {/* Visualisation placeholder — mirrors VizPlaceholder height. */}
      <Box paddingX={4} paddingY={3}>
        <Skeleton height="120px" borderRadius="md" />
      </Box>

      <Box borderBottomWidth="1px" borderColor="border" />

      {/* Span tab bar. */}
      <HStack paddingX={4} paddingY={2} gap={3}>
        <Skeleton height="26px" width="84px" borderRadius="sm" />
        <Skeleton height="26px" width="104px" borderRadius="sm" />
        <Skeleton height="26px" width="76px" borderRadius="sm" />
        <Skeleton height="26px" width="92px" borderRadius="sm" />
      </HStack>

      <Box borderBottomWidth="1px" borderColor="border" />

      {/* Accordion / panel body. */}
      <VStack align="stretch" gap={2} padding={4}>
        <Skeleton height="44px" borderRadius="md" />
        <Skeleton height="120px" borderRadius="md" />
        <Skeleton height="44px" borderRadius="md" />
        <Skeleton height="80px" borderRadius="md" />
        <Skeleton height="44px" borderRadius="md" />
      </VStack>
    </VStack>
  );
}
