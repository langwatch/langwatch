export interface Protections {
  canSeeCosts?: boolean | undefined | null;
  canSeeCapturedInput?: boolean | undefined | null;
  canSeeCapturedOutput?: boolean | undefined | null;
  /**
   * ADR-028 plan-based visibility window: traces/spans started before this
   * epoch-ms cutoff get their content teaser-redacted. `null`/`undefined` =
   * no window (paid/licensed plans, internal reads).
   */
  visibilityCutoffMs?: number | null;
}
