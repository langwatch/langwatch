/**
 * The budgets of local control (ADR-129). One place, so the worker's
 * long-poll, the CLI's timeouts and the card's countdowns cannot drift apart.
 */

/** A control request the card records; the CLI must approve within this. */
export const CONTROL_REQUEST_TTL_MS = 15 * 60 * 1000;

/** How long the worker's long-poll holds before it answers "still running". */
export const CALL_POLL_HOLD_MS = 20_000;

/** A CLI heartbeat refreshes presence at this interval. */
export const PRESENCE_HEARTBEAT_MS = 10_000;

/** A folder not seen for this long reads offline. */
export const PRESENCE_TTL_MS = 30_000;

/** The first local call of a turn waits this long for the folder to appear. */
export const CALL_OFFLINE_WAIT_MS = 5_000;

/** A permission card no one answers expires after this. */
export const PERMISSION_WAIT_BUDGET_MS = 10 * 60 * 1000;

/** A question card no one answers returns "no answer yet" after this. */
export const QUESTION_WAIT_BUDGET_MS = 10 * 60 * 1000;

/** While a call waits, the live stream gets a keepalive entry this often. */
export const LIVE_STREAM_KEEPALIVE_MS = 60_000;

/** Command output returned to the model; the rest stays in the log file. */
export const BASH_OUTPUT_CAP_BYTES = 64 * 1024;

/** A command with no timeout of its own stops after this. */
export const BASH_DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/** The longest timeout a command may ask for. */
export const BASH_MAX_TIMEOUT_MS = 15 * 60 * 1000;

/** A call envelope lives in Redis this long past its deadline. */
export const CALL_ENVELOPE_SLACK_MS = 60_000;

/** A result waits in Redis this long for the worker to poll it. */
export const CALL_RESULT_TTL_MS = 60_000;

/** Where the CLI keeps command logs inside the shared folder. */
export const LOCAL_LOG_DIR = ".langwatch/langy-logs";
