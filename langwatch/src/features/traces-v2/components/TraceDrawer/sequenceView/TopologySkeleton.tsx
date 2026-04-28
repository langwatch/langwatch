import { Box, Flex, VStack } from "@chakra-ui/react";

/**
 * Skeleton for the topology view — outlines a small node graph with edges
 * pulsing between them. Different shape from SequenceSkeleton (which depicts
 * lifelines), so users can tell at a glance which view is loading.
 */
const PULSE = {
  "@keyframes topoPulse": {
    "0%, 100%": { opacity: 0.4 },
    "50%": { opacity: 0.85 },
  },
} as const;

const NODES = [
  { left: "10%", top: "30%", width: "16%", height: "26px", palette: "purple" },
  { left: "38%", top: "20%", width: "18%", height: "26px", palette: "blue" },
  { left: "38%", top: "60%", width: "18%", height: "26px", palette: "green" },
  { left: "70%", top: "30%", width: "18%", height: "26px", palette: "blue" },
  { left: "70%", top: "70%", width: "18%", height: "26px", palette: "gray" },
] as const;

const EDGES = [
  { x1: "26%", y1: "43%", x2: "38%", y2: "33%", delay: 0 },
  { x1: "26%", y1: "43%", x2: "38%", y2: "73%", delay: 0.1 },
  { x1: "56%", y1: "33%", x2: "70%", y2: "43%", delay: 0.2 },
  { x1: "56%", y1: "73%", x2: "70%", y2: "83%", delay: 0.3 },
] as const;

export function TopologySkeleton() {
  return (
    <VStack align="stretch" gap={0} height="full" overflow="hidden" bg="bg">
      {/* Toolbar placeholder */}
      <Flex
        align="center"
        gap={1.5}
        paddingX={2.5}
        paddingY={1.5}
        borderBottomWidth="1px"
        borderColor="border.subtle"
        bg="bg.subtle/60"
        flexShrink={0}
        css={PULSE}
      >
        <Box
          width="80px"
          height="14px"
          borderRadius="sm"
          bg="bg.muted"
          css={{ animation: "topoPulse 1.4s ease-in-out infinite" }}
        />
        <Box flex="1" />
        <Box
          width="120px"
          height="14px"
          borderRadius="sm"
          bg="bg.muted"
          css={{ animation: "topoPulse 1.4s ease-in-out 0.1s infinite" }}
        />
      </Flex>

      {/* Graph placeholder */}
      <Box
        flex="1"
        position="relative"
        css={{
          ...PULSE,
          backgroundImage:
            "radial-gradient(circle, var(--chakra-colors-border-subtle) 1px, transparent 1px)",
          backgroundSize: "16px 16px",
        }}
      >
        {/* Edges (rendered as svg lines) */}
        <Box
          position="absolute"
          inset={0}
          as="svg"
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          {...({ viewBox: "0 0 100 100", preserveAspectRatio: "none" } as any)}
        >
          {EDGES.map((e, i) => (
            <line
              key={i}
              x1={e.x1}
              y1={e.y1}
              x2={e.x2}
              y2={e.y2}
              stroke="var(--chakra-colors-border-emphasized)"
              strokeWidth="0.4"
              strokeOpacity="0.5"
              style={{
                animation: `topoPulse 1.4s ease-in-out ${e.delay}s infinite`,
              }}
            />
          ))}
        </Box>

        {/* Nodes */}
        {NODES.map((n, i) => (
          <Box
            key={i}
            position="absolute"
            top={n.top}
            left={n.left}
            width={n.width}
            height={n.height}
            borderRadius="md"
            bg={`${n.palette}.subtle`}
            borderWidth="1px"
            borderColor={`${n.palette}.muted`}
            css={{
              animation: `topoPulse 1.4s ease-in-out ${i * 0.07}s infinite`,
            }}
          />
        ))}
      </Box>
    </VStack>
  );
}
