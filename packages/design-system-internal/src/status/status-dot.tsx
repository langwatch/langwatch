export type StatusState = "live" | "starting" | "down" | "unknown";

export type StatusDotProps = {
  state: StatusState;
  /** Replaces the state's word; state is never colour alone, so a label always shows. */
  label?: string;
};

const stateWords: Record<StatusState, string> = {
  live: "Live",
  starting: "Starting",
  down: "Down",
  unknown: "Unknown",
};

export const StatusDot = ({ state, label }: StatusDotProps) => (
  <span className="ds-status">
    <span className="ds-dot" data-state={state} aria-hidden="true" />
    {label === undefined || label.length === 0 ? stateWords[state] : label}
  </span>
);
