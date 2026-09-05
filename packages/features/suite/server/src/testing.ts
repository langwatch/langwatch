/**
 * The seam another feature's tests drive the suite feature through.
 *
 * A test composes a real suite execution to prove what the suite writes; the
 * feature's own contract carries no such handle, so the two names it needs are
 * republished here rather than reached for across the package boundary.
 */
export { SuiteExecutionService } from "./services/suite-execution.service";
export type { QueueSimulationRunCommandData } from "./ports/suite-execution.port";
