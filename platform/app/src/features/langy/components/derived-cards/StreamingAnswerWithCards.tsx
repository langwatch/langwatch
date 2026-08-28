import type { ReactNode } from "react";
import {
  LangyCardBoundary,
  LangyStreamingAnswerWithCards,
} from "@langwatch/langy-web";
import { LangyDerivedCardView } from "./LangyDerivedCardView";

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
