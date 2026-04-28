import { Box, Flex, HStack, VStack } from "@chakra-ui/react";

/**
 * Skeleton placeholder shown while the sequence-view chunk + Mermaid library
 * are loading. Hand-drawn outline of a sequence diagram (4 participants,
 * lifelines, two signal arrows) that pulses gently — gives a clear "this is
 * the map view, hold tight" affordance instead of a generic block skeleton.
 */
const PULSE = {
  "@keyframes seqPulse": {
    "0%, 100%": { opacity: 0.45 },
    "50%": { opacity: 0.85 },
  },
} as const;

const PARTICIPANTS = [
  { left: "8%", width: "14%" },
  { left: "30%", width: "14%" },
  { left: "52%", width: "14%" },
  { left: "74%", width: "14%" },
] as const;

const SIGNALS = [
  { fromLeft: 15, toLeft: 37, top: "44%", delay: 0 },
  { fromLeft: 37, toLeft: 59, top: "56%", delay: 0.15 },
  { fromLeft: 59, toLeft: 81, top: "68%", delay: 0.3 },
  { fromLeft: 37, toLeft: 15, top: "80%", delay: 0.45 },
] as const;

export function SequenceSkeleton() {
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
          css={{ animation: "seqPulse 1.4s ease-in-out infinite" }}
        />
        <Box flex="1" />
        <Box
          width="120px"
          height="14px"
          borderRadius="sm"
          bg="bg.muted"
          css={{ animation: "seqPulse 1.4s ease-in-out 0.1s infinite" }}
        />
      </Flex>

      {/* Diagram placeholder */}
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
        {/* Participant boxes */}
        <HStack
          position="absolute"
          top="20px"
          left="0"
          right="0"
          justify="space-around"
          paddingX={4}
        >
          {PARTICIPANTS.map((p, i) => (
            <Box
              key={i}
              width={p.width}
              height="22px"
              borderRadius="md"
              bg="purple.subtle"
              borderWidth="1px"
              borderColor="purple.muted"
              css={{
                animation: `seqPulse 1.4s ease-in-out ${i * 0.08}s infinite`,
              }}
            />
          ))}
        </HStack>

        {/* Lifelines (dotted vertical lines) */}
        {PARTICIPANTS.map((p, i) => (
          <Box
            key={`life-${i}`}
            position="absolute"
            top="48px"
            bottom="20px"
            left={`calc(${p.left} + ${p.width} / 2)`}
            width="1px"
            css={{
              borderLeft: "1px dashed var(--chakra-colors-border-emphasized)",
              opacity: 0.4,
            }}
          />
        ))}

        {/* Signal arrows */}
        {SIGNALS.map((s, i) => {
          const left = Math.min(s.fromLeft, s.toLeft);
          const width = Math.abs(s.toLeft - s.fromLeft);
          return (
            <Box
              key={`sig-${i}`}
              position="absolute"
              top={s.top}
              left={`${left}%`}
              width={`${width}%`}
              height="2px"
              borderRadius="full"
              bg="border.emphasized"
              opacity={0.5}
              css={{
                animation: `seqPulse 1.4s ease-in-out ${s.delay}s infinite`,
              }}
            />
          );
        })}
      </Box>
    </VStack>
  );
}
