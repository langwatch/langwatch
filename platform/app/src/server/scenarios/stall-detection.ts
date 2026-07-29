/**
 * How long a scenario run may go without an event before nothing is executing
 * it any more.
 *
 * This module used to also derive a `STALLED` status at read time, which meant
 * the stored status and the displayed status disagreed by design. ADR-073 made
 * `STALLED` a stored status written by the `scenarioExecution` process
 * manager's deadline, and the last read-time consumer went with it — so what is
 * left is the horizon itself, which the two boot reconcilers still measure
 * against.
 */

import { CHILD_PROCESS } from "./scenario.constants";

/**
 * Threshold in milliseconds after which a run with no terminal event has
 * provably lost whatever was executing it. Set to 2x the child process timeout
 * to cover all reasonable completion scenarios.
 */
export const STALL_THRESHOLD_MS = CHILD_PROCESS.TIMEOUT_MS * 2;
