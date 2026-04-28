import { Box, HStack, Spinner, Text } from "@chakra-ui/react";
import { Kbd } from "~/components/ops/shared/Kbd";
import { Tooltip } from "~/components/ui/tooltip";

export function ThreadProgressIndicator({
  position,
  total,
  isLoading = false,
}: {
  position: number;
  total: number;
  isLoading?: boolean;
}) {
  const safePosition = Math.max(1, Math.min(position, total));
  const percent = total > 0 ? (safePosition / total) * 100 : 0;
  return (
    <Tooltip
      content={
        <HStack gap={1}>
          <Text>{isLoading ? "Loading…" : "Navigate thread"}</Text>
          <Kbd>J</Kbd>
          <Kbd>K</Kbd>
        </HStack>
      }
      positioning={{ placement: "bottom" }}
    >
      <HStack gap={1.5} flexShrink={0} cursor="default">
        {isLoading ? (
          <Spinner size="xs" color="blue.solid" borderWidth="1.5px" />
        ) : null}
        <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
          {safePosition} / {total}
        </Text>
        <Box
          width="48px"
          height="2px"
          borderRadius="full"
          bg="border.muted"
          overflow="hidden"
          position="relative"
        >
          <Box
            width={`${percent}%`}
            height="full"
            bg="blue.solid"
            transition="width 0.18s ease"
            opacity={isLoading ? 0.5 : 1}
          />
          {isLoading ? (
            <Box
              position="absolute"
              inset={0}
              css={{
                background:
                  "linear-gradient(90deg, transparent, var(--chakra-colors-blue-solid) 50%, transparent)",
                backgroundSize: "200% 100%",
                animation: "threadShimmer 1.1s ease-in-out infinite",
                "@keyframes threadShimmer": {
                  "0%": { backgroundPosition: "200% 0" },
                  "100%": { backgroundPosition: "-200% 0" },
                },
                opacity: 0.7,
              }}
            />
          ) : null}
        </Box>
      </HStack>
    </Tooltip>
  );
}
