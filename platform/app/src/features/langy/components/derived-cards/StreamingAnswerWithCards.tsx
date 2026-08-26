import type { ReactNode } from "react";
import { LangyStreamingAnswerWithCards } from "@langwatch/langy-web";
import { LangyCardBoundary } from "../LangyCardBoundary";
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
