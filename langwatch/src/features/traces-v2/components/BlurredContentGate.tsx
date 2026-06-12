import { Box, Button, Text, VStack } from "@chakra-ui/react";
import { Lock } from "lucide-react";
import { memo, useMemo } from "react";

import { Link } from "~/components/ui/link";

/**
 * Upgrade treatment for visibility-window-redacted content (ADR-028 §7).
 *
 * The server sends only the real ~10% teaser; this component fabricates the
 * "rest" of the content as garbage words — deterministically seeded from the
 * traceId so renders are stable — and fades them through progressive blur,
 * with a centered upgrade card on top. The filler NEVER comes from (or goes
 * to) the server: it exists purely to make visible that there is more here.
 */

const FILLER_WORDS = [
  "response",
  "context",
  "tokens",
  "latency",
  "the",
  "model",
  "returned",
  "with",
  "analysis",
  "pipeline",
  "request",
  "completion",
  "evaluation",
  "messages",
  "structured",
  "output",
  "reasoning",
  "agent",
  "between",
  "criteria",
  "detailed",
  "result",
  "processing",
  "semantic",
  "during",
  "payload",
  "interaction",
  "generated",
  "metrics",
  "additional",
] as const;

/** Deterministic PRNG (mulberry32) so the same trace always renders the same filler. */
const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const hashString = (input: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const fillerLine = (rand: () => number, words: number): string =>
  Array.from(
    { length: words },
    () => FILLER_WORDS[Math.floor(rand() * FILLER_WORDS.length)],
  ).join(" ");

/** Three progressively blurrier filler rows behind the upgrade card. */
const BLUR_STEPS = [
  { blur: "2px", opacity: 0.55 },
  { blur: "4px", opacity: 0.4 },
  { blur: "6px", opacity: 0.25 },
] as const;

export const BlurredContentGate = memo(function BlurredContentGate({
  traceId,
}: {
  /** Seeds the fabricated filler so re-renders are stable per trace. */
  traceId: string;
}) {
  const lines = useMemo(() => {
    const rand = mulberry32(hashString(traceId));
    return BLUR_STEPS.map(() => fillerLine(rand, 14 + Math.floor(rand() * 8)));
  }, [traceId]);

  return (
    <Box position="relative" data-testid="blurred-content-gate">
      <VStack align="stretch" gap={1.5} aria-hidden="true" userSelect="none">
        {lines.map((line, i) => (
          <Text
            key={i}
            fontSize="sm"
            color="fg.muted"
            filter={`blur(${BLUR_STEPS[i]!.blur})`}
            opacity={BLUR_STEPS[i]!.opacity}
            lineClamp={1}
          >
            {line}
          </Text>
        ))}
      </VStack>
      <Box
        position="absolute"
        inset={0}
        display="flex"
        alignItems="center"
        justifyContent="center"
        bgGradient="to-b"
        gradientFrom="transparent"
        gradientTo="bg.panel"
      >
        <VStack
          gap={1}
          paddingX={5}
          paddingY={3}
          borderRadius="lg"
          borderWidth="1px"
          backgroundColor="bg.panel"
          boxShadow="md"
        >
          <Text fontSize="sm" fontWeight="semibold" display="flex" alignItems="center" gap={1.5}>
            <Lock size={13} /> Your data is still here
          </Text>
          <Text fontSize="xs" color="fg.muted" textAlign="center">
            Traces older than your plan&apos;s visibility window are hidden.
          </Text>
          <Link href="/settings/subscription">
            <Button size="2xs" colorPalette="orange" marginTop={1}>
              Upgrade to unlock
            </Button>
          </Link>
        </VStack>
      </Box>
    </Box>
  );
});
