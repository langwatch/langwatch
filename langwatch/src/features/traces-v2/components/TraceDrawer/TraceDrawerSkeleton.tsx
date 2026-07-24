import { Box, Button, HStack, Icon, Skeleton, VStack } from "@chakra-ui/react";
import { LuX } from "react-icons/lu";
import { Tooltip } from "~/components/ui/tooltip";

interface TraceDrawerSkeletonProps {
  onClose: () => void;
  /**
   * Span count carried over from the table row that opened the drawer.
   * When known, the accordion body section renders that many skeleton
   * rows so the panel doesn't reflow once the real spanTree query
   * resolves. `null` for entry paths that don't have the row in hand
   * (URL hydration, history back/forward) — the skeleton then falls
   * back to a small default block.
   */
  expectedSpanCount?: number | null;
}

/**
 * Layout-mirroring skeleton for the trace drawer. Mirrors the real
 * `DrawerHeader` + viz + tab-bar + accordion structure so the loading state
 * doesn't reflow the panel when content arrives, and so the close affordance
 * stays clickable while the trace fetches.
 */
// Visible-span budget for the skeleton body. Most operators won't scroll
// past ~30 rows during a load; rendering more is wasted layout work.
const MAX_SKELETON_SPAN_ROWS = 30;
// Approximate height of a single span row in the accordion when fully
// rendered. Matches the SpanAccordions row height at the comfortable
// density — close enough that the post-load swap reads as silent.
const SPAN_SKELETON_ROW_PX = 36;

export function TraceDrawerSkeleton({
  onClose,
  expectedSpanCount,
}: TraceDrawerSkeletonProps) {
  return (
    // Solid surface bg — `Drawer.Content` is transparent (so the real
    // header below can run a backdrop-blur fill against the page),
    // and the skeleton has no equivalent translucent layer, so it
    // would otherwise float on the page during the loading flash.
    <VStack
      align="stretch"
      gap={0}
      flex={1}
      minHeight={0}
      bg={{ base: "bg.surface", _dark: "bg.panel" }}
    >
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

      {/* Accordion / panel body. When we know the row's span count (from
          the trace summary projection on the table row that triggered
          the drawer) we render that many skeleton "span" rows so the
          panel's height matches what the live spanTree will eventually
          fill. Falls back to a small placeholder block when the count
          isn't available (URL hydration, history navigation). */}
      <VStack align="stretch" gap={2} padding={4}>
        {expectedSpanCount && expectedSpanCount > 0 ? (
          <>
            {/* Section header skeletons (Spans / Events / Evals). */}
            <Skeleton height="44px" borderRadius="md" />
            {/* Span rows — one per span, capped at MAX_SKELETON_SPAN_ROWS
                so a 1000-span trace doesn't render a 36 000 px column. */}
            {Array.from({
              length: Math.min(expectedSpanCount, MAX_SKELETON_SPAN_ROWS),
            }).map((_, i) => (
              <Skeleton
                key={`span-${i}`}
                height={`${SPAN_SKELETON_ROW_PX}px`}
                borderRadius="sm"
              />
            ))}
          </>
        ) : (
          <>
            <Skeleton height="44px" borderRadius="md" />
            <Skeleton height="120px" borderRadius="md" />
            <Skeleton height="44px" borderRadius="md" />
            <Skeleton height="80px" borderRadius="md" />
            <Skeleton height="44px" borderRadius="md" />
          </>
        )}
      </VStack>
    </VStack>
  );
}
