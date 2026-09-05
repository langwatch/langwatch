import { useEffect, useState } from "react";
import type { DashboardWidgetQuery } from "~/server/analytics/dashboardWidgetDefinition";

interface WidgetDraftSeed {
  name: string;
  code: string;
  queries: DashboardWidgetQuery[];
}

/** Cheap and correct at this scale: a widget's queries are a handful of small objects. */
function queriesEqual(
  a: DashboardWidgetQuery[],
  b: DashboardWidgetQuery[],
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The name/code/queries draft for one persisted widget (the card and the
 * in-place editor). Reseeds whenever the persisted record changes underneath
 * it — a save from this surface, or a refetch — and exposes `resetToWidget`
 * for a discarded edit and `isDirty` for the Save gate.
 *
 * `isFrozen` suspends reseeding: while the edit drawer is open the chart
 * previews the LIVE draft, so a background refetch that remaps `widget.queries`
 * must not fire the reseed and clobber an in-progress edit.
 */
export function useWidgetDraft({
  widget,
  isFrozen = false,
}: {
  widget: WidgetDraftSeed;
  isFrozen?: boolean;
}) {
  const [draftName, setDraftName] = useState(widget.name);
  const [draftCode, setDraftCode] = useState(widget.code);
  const [draftQueries, setDraftQueries] = useState(widget.queries);

  useEffect(() => {
    if (isFrozen) return;
    setDraftName(widget.name);
    setDraftCode(widget.code);
    setDraftQueries(widget.queries);
  }, [widget.name, widget.code, widget.queries, isFrozen]);

  const resetToWidget = () => {
    setDraftName(widget.name);
    setDraftCode(widget.code);
    setDraftQueries(widget.queries);
  };

  const isDirty =
    draftName !== widget.name ||
    draftCode !== widget.code ||
    !queriesEqual(draftQueries, widget.queries);

  return {
    draftName,
    setDraftName,
    draftCode,
    setDraftCode,
    draftQueries,
    setDraftQueries,
    resetToWidget,
    isDirty,
  };
}
