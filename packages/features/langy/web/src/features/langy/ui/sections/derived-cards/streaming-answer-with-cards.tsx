import type { ReactNode } from "react";
import {
  LangyCardBoundary,
  LangyStreamingAnswerWithCards,
} from "../../../../../index";
import { LangyDerivedCardView } from "./langy-derived-card-view";

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
