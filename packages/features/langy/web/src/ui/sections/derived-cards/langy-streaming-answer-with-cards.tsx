/**
 * The live turn's answer, with blocks previewing as they stream (ADR-060 §7).
 */
import { Box, VStack } from "@chakra-ui/react";
import {
  feedLangyDerivedCardPreview,
  type LangyDerivedCardPreview,
  mightContainLangyCardFence,
  splitLangyCardFences,
} from "@langwatch/langy-contract";
import { Fragment, useMemo, useRef, type ReactNode } from "react";
import { StreamingText } from "../streaming-text";
import { LangyDerivedCardView, type LangyDerivedCardViewProps } from "./langy-derived-card-view";

type StreamSegment =
  | { type: "text"; text: string }
  | { type: "preview"; preview: LangyDerivedCardPreview; closed: boolean };

export function LangyStreamingAnswerWithCards({
  text,
  projectSlug,
  renderCardView,
  renderBoundary = (children) => children,
}: {
  text: string;
  projectSlug?: string | null;
  renderCardView?: (props: LangyDerivedCardViewProps) => ReactNode;
  renderBoundary?: (children: ReactNode) => ReactNode;
}) {
  // Latest validating block per fence ordinal, surviving re-renders for the
  // life of this message's component (keyed by message id upstream). A ref,
  // not state: the reducer feeds forward monotonically with the text.
  const previewsRef = useRef<Map<number, LangyDerivedCardPreview>>(new Map());

  const segments = useMemo<StreamSegment[]>(() => {
    if (!mightContainLangyCardFence(text)) {
      return [{ type: "text", text }];
    }
    const previews = previewsRef.current;
    let ordinal = 0;
    return splitLangyCardFences(text).map((segment): StreamSegment => {
      if (segment.type === "text") {
        return { type: "text", text: segment.text };
      }
      const key = ordinal++;
      const next = feedLangyDerivedCardPreview(previews.get(key), segment.raw);
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
        if (!segment.preview.card) return null;
        const cardProps = {
          card: segment.preview.card,
          forming: true,
          projectSlug,
        } satisfies LangyDerivedCardViewProps;
        const card = renderCardView ? (
          renderCardView(cardProps)
        ) : (
          <LangyDerivedCardView {...cardProps} />
        );
        return (
          <Fragment key={`preview-${segment.preview.card.blockId}-${index}`}>
            {renderBoundary(card)}
          </Fragment>
        );
      })}
    </VStack>
  );
}
