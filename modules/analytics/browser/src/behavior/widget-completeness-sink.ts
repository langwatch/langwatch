/**
 * Carries a widget's completeness from its frame up to the card around it, so the card's (i)
 * can say what the data is missing while the face stays clean. The card provides the sink; the
 * frame writes to it. Outside a card there is no sink and nothing is published.
 */

import { createContext, useContext, useEffect } from "react";

import type { WidgetCompleteness } from "../model/dashboard-widget/widget-completeness.ts";

export type WidgetCompletenessSink = (completeness: WidgetCompleteness | null) => void;

export const WidgetCompletenessSinkContext = createContext<WidgetCompletenessSink | undefined>(
  undefined,
);

/** Publishes the frame's latest completeness to its card, and clears it when the frame goes. */
export function usePublishWidgetCompleteness(completeness: WidgetCompleteness | null): void {
  const publish = useContext(WidgetCompletenessSinkContext);
  useEffect(() => {
    publish?.(completeness);
  }, [publish, completeness]);
  useEffect(() => () => publish?.(null), [publish]);
}
