import type { ReactNode } from "react";
import { LangyCardBoundary } from "../../../../../ui/elements/langy-card-boundary.tsx";
import { LangyStreamingAnswerWithCards } from "../../../../../ui/sections/derived-cards/langy-streaming-answer-with-cards.tsx";
import { LangyDerivedCardView } from "./langy-derived-card-view.tsx";

export function StreamingAnswerWithCards({
  text,
  projectSlug,
}: {
  text: string;
  projectSlug?: string | null;
}) {
  return (
    <LangyStreamingAnswerWithCards
      text={text}
      projectSlug={projectSlug}
      renderCardView={(props) => <LangyDerivedCardView {...props} />}
      renderBoundary={(children: ReactNode) => (
        <LangyCardBoundary scope="this forming card">{children}</LangyCardBoundary>
      )}
    />
  );
}
