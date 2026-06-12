import { Box, Button, Text, VStack } from "@chakra-ui/react";
import { Lock } from "lucide-react";
import { memo, useMemo } from "react";

import { Link } from "~/components/ui/link";

/**
 * Upgrade treatment for visibility-window-redacted content (ADR-028 §7).
 *
 * The server sends only the real ~10% teaser; this renders the "rest" as a
 * single continuous paragraph of fabricated words — deterministically seeded
 * from the traceId so renders are stable — styled exactly like the real
 * content so the two read as one text. A progressive blur (light at the top,
 * maximal at the bottom) plus a fade make it visibly locked, with the
 * upgrade card centered over it. The filler NEVER comes from (or goes to)
 * the server: it exists purely to make visible that there is more here.
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

const fillerParagraph = (rand: () => number, words: number): string =>
  Array.from(
    { length: words },
    () => FILLER_WORDS[Math.floor(rand() * FILLER_WORDS.length)],
  ).join(" ");

/**
 * The same paragraph stacked in three layers, each masked to a horizontal
 * band with increasing blur — reads as ONE text that gets progressively
 * blurrier from top to bottom (top light, bottom maximal).
 */
const BLUR_LAYERS = [
  { blur: "1.5px", mask: "linear-gradient(to bottom, black 0%, black 30%, transparent 55%)" },
  { blur: "3.5px", mask: "linear-gradient(to bottom, transparent 20%, black 45%, black 60%, transparent 85%)" },
  { blur: "6px", mask: "linear-gradient(to bottom, transparent 50%, black 80%, black 100%)" },
] as const;

export const BlurredContentGate = memo(function BlurredContentGate({
  traceId,
  fontFamily = "inherit",
}: {
  /** Seeds the fabricated filler so re-renders are stable per trace. */
  traceId: string;
  /** Match the surrounding content's font (e.g. "mono" in pretty views). */
  fontFamily?: string;
}) {
  const paragraph = useMemo(() => {
    const rand = mulberry32(hashString(traceId));
    return fillerParagraph(rand, 60 + Math.floor(rand() * 20));
  }, [traceId]);

  return (
    <Box
      position="relative"
      data-testid="blurred-content-gate"
      marginTop="-2px"
      paddingBottom={2}
    >
      {/* One continuous paragraph, three masked blur layers: light → max. */}
      <Box position="relative" aria-hidden="true" userSelect="none" minHeight="120px">
        {BLUR_LAYERS.map((layer, i) => (
          <Text
            key={i}
            position={i === 0 ? "relative" : "absolute"}
            inset={i === 0 ? undefined : 0}
            fontSize="inherit"
            lineHeight="inherit"
            fontFamily={fontFamily}
            color="fg"
            filter={`blur(${layer.blur})`}
            style={{
              maskImage: layer.mask,
              WebkitMaskImage: layer.mask,
            }}
          >
            {paragraph}
          </Text>
        ))}
        {/* Fade the tail into the background so the text dissolves. */}
        <Box
          position="absolute"
          inset={0}
          bgGradient="to-b"
          gradientFrom="transparent"
          gradientVia="transparent"
          gradientTo="bg.panel"
          pointerEvents="none"
        />
      </Box>
      <Box
        position="absolute"
        inset={0}
        display="flex"
        alignItems="center"
        justifyContent="center"
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
          <Text
            fontSize="sm"
            fontWeight="semibold"
            display="flex"
            alignItems="center"
            gap={1.5}
          >
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

/**
 * Appends a continuation ellipsis to teaser text so the visible cut reads
 * as "…the text continues" instead of an abrupt stop. Client-side only —
 * the API payload stays the pure teaser.
 */
export const withTeaserEllipsis = (content: string): string =>
  content.endsWith("…") || content.endsWith("...") ? content : `${content} …`;
