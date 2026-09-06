/**
 * What a reader sees while the API is still coming up.
 * Spec: specs/ui/api-boot-wait.feature
 */

import "./ui-api-waiting.css";

/** The one command that starts the API on a developer's own machine. */
export const UI_API_DEV_COMMAND = "pnpm dev:api";

export type UiApiWaitingScreenProps = {
  /** The address being polled, said in full so it can be pasted. */
  readonly endpoint: string;
  /**
   * Whether this is a developer's own stack. A developer's API is starting;
   * everybody else's went away, and telling them to run a command would be
   * telling them to fix a machine they do not have.
   */
  readonly isDevelopment: boolean;
  /** Whether the wait has run long enough to be worth explaining. */
  readonly explaining: boolean;
};

export function UiApiWaitingScreen({
  endpoint,
  isDevelopment,
  explaining,
}: UiApiWaitingScreenProps) {
  return (
    <div className="lw-api-waiting" role="status" aria-live="polite" data-testid="api-waiting">
      <div className="lw-api-waiting-mesh" aria-hidden="true" />
      <div className="lw-api-waiting-body">
        <h1 className="lw-api-waiting-heading">
          {isDevelopment ? "Starting the API" : "Reconnecting"}
        </h1>
        <p className="lw-api-waiting-endpoint" data-testid="api-waiting-endpoint">
          {endpoint}
        </p>
        <div className="lw-api-waiting-pulse" aria-hidden="true" />
        {explaining && isDevelopment ? (
          <p className="lw-api-waiting-hint" data-testid="api-waiting-hint">
            Start it with {UI_API_DEV_COMMAND}
          </p>
        ) : null}
      </div>
    </div>
  );
}
