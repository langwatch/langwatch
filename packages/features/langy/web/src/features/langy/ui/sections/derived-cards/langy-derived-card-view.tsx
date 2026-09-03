import type { ComponentProps } from "react";
import { ArrowUpRight } from "lucide-react";
import {
  LangyDerivedCardView as LangyDerivedCardViewPresentation,
  type LangyExploreLinkProps,
} from "../../../../../index";
import { buildTraceExplorerHref, readTraceSearchQuery } from "../../../../../index";
import { TimeseriesPlot } from "../capabilities/langy-timeseries-card";
import { LangySpaAnchor } from "../langy-spa-anchor";
import { useChoicesRefRows } from "../../../behavior/derived-cards/use-choices-ref-rows";

export type LangyDerivedCardViewProps = ComponentProps<typeof LangyDerivedCardViewPresentation>;

/**
 * App composition adapter: the renderer is package-owned; routing and the
 * analytics chart remain application capabilities.
 */
export function LangyDerivedCardView({ projectSlug, ...props }: LangyDerivedCardViewProps) {
  const choiceOptions = props.card.kind === "choices" ? props.card.options : [];
  const choiceRefRows = useChoicesRefRows(choiceOptions);

  return (
    <LangyDerivedCardViewPresentation
      {...props}
      projectSlug={projectSlug}
      renderTimeseries={(card) => <TimeseriesPlot payload={card} />}
      renderExploreLink={renderExploreLink}
      choiceRefRows={choiceRefRows}
      resolveExploreHref={(query, slug) => {
        const search = readTraceSearchQuery(query);
        if (
          search.query === undefined &&
          !search.origins?.length &&
          search.startDate === undefined &&
          search.endDate === undefined
        ) {
          return null;
        }
        return buildTraceExplorerHref({ projectSlug: slug, search });
      }}
    />
  );
}

function renderExploreLink({ href, children }: LangyExploreLinkProps) {
  return (
    <LangySpaAnchor
      href={href}
      display="inline-flex"
      alignItems="center"
      gap={1}
      textStyle="xs"
      fontWeight="560"
      color="orange.solid"
      _hover={{ textDecoration: "underline" }}
    >
      {children}
      <ArrowUpRight size={12} />
    </LangySpaAnchor>
  );
}
