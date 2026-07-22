/**
 * The live turn's answer, with blocks previewing as they stream
 * (ADR-060 §7).
 *
 * While the assistant text streams, any ```langy-card fence in it is fed —
 * chunk by chunk — through the SAME salvage + validation the relay will
 * stamp with at settle (`feedLangyCardBlockPreview`), so a preview is only
 * ever shown for data that already validates: nothing renders for a fence
 * until a validating prefix exists, the card grows as points arrive, and a
 * chunk that momentarily breaks validation keeps the last good block on
 * screen instead of flickering.
 *
 * Previews are a live-stream affair. At settle the relay's stamped parts
 * replace the streamed text wholesale (the settled part wins — the same
 * server-clock rule the text merge follows), and this component simply
 * stops rendering: the settled path (`AnswerWithBlocks`) draws the one true
 * card. Preview and settled card can never coexist, so "exactly one card"
 * holds by construction, not by bookkeeping.
 *
 * A forming card is never interactive: choices render visibly forming and
 * unanswerable until the stamped part arrives.
 */
import { Box, VStack } from "@chakra-ui/react";
import {
  feedLangyCardBlockPreview,
  splitLangyCardFences,
  type LangyCardBlockPreview,
} from "@langwatch/langy";
import { useMemo, useRef } from "react";

import { LangyCardBoundary } from "../LangyCardBoundary";
import { StreamingText } from "../StreamingText";
import { LangyDerivedBlockCard } from "./LangyDerivedBlockCard";

/** Cheap heuristic gate: fence-less streams never pay for the line scan. */
const FENCE_MARKER = "```langy-card";

type StreamSegment =
  | { type: "text"; text: string }
  | { type: "preview"; preview: LangyCardBlockPreview; closed: boolean };

export function StreamingAnswerWithBlocks({
  text,
  projectSlug,
}: {
  text: string;
  projectSlug?: string | null;
}) {
  // Latest validating block per fence ordinal, surviving re-renders for the
  // life of this message's component (keyed by message id upstream). A ref,
  // not state: the reducer feeds forward monotonically with the text.
  const previewsRef = useRef<Map<number, LangyCardBlockPreview>>(new Map());

  const segments = useMemo<StreamSegment[]>(() => {
    if (!text.includes(FENCE_MARKER)) {
      return [{ type: "text", text }];
    }
    const previews = previewsRef.current;
    let ordinal = 0;
    return splitLangyCardFences(text).map((segment): StreamSegment => {
      if (segment.type === "text") {
        return { type: "text", text: segment.text };
      }
      const key = ordinal++;
      const next = feedLangyCardBlockPreview(previews.get(key), segment.raw);
      previews.set(key, next);
      return { type: "preview", preview: next, closed: segment.closed };
    });
  }, [text]);

  return (
    <VStack align="stretch" gap={2.5}>
      {segments.map((segment, index) => {
        if (segment.type === "text") {
          return (
            <Box
              key={`text-${index}`}
              fontSize="langyAnswer"
              color="langy.answerFg"
              lineHeight="1.6"
            >
              <StreamingText text={segment.text} />
            </Box>
          );
        }
        // No card preview until a validating prefix exists — never a
        // non-validating guess, never a placeholder pretending to be one.
        if (!segment.preview.block) return null;
        return (
          <LangyCardBoundary
            key={`preview-${segment.preview.block.blockId}-${index}`}
            scope="this forming card"
          >
            <LangyDerivedBlockCard
              card={segment.preview.block}
              forming
              projectSlug={projectSlug}
            />
          </LangyCardBoundary>
        );
      })}
    </VStack>
  );
}
