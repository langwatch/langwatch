/** What a caller hands automation's editor drawer: an automation, or prefills for a new one. */
export type UiAutomationDrawerProps = {
  automationId?: string;
  /** Set by the email "Edit automation" link, so the drawer shows its landing banner. */
  source?: string;
  /** Opens in graph-alert mode with this graph locked in. */
  prefilledGraphId?: string;
  prefilledSeriesName?: string;
  /** Fresh-create prefills; `initialFilters` is the persisted filter JSON. */
  initialSource?: string;
  initialName?: string;
  initialAction?: string;
  initialFilters?: string;
  /** A traces query to seed a fresh trace automation's subject with. */
  initialFilterQuery?: string;
  onClose: () => void;
};
