/**
 * What makes one suite run the same run as another: the ids a run is filed
 * under, derived from the request rather than minted per call.
 * @see specs/suites/suite-run-retry-safety.feature
 */
import { createHash } from "node:crypto";
import {
  canonicalParameters,
  targetKeyOf,
  type SuiteRunParameters,
  type SuiteTarget,
} from "@langwatch/suite-contract";

/** The kinds these name — `KSUID_RESOURCES.SCENARIO_BATCH` and `SCENARIO_RUN`. */
const BATCH_RUN_ID_PREFIX = "scenariobatch";
const SCENARIO_RUN_ID_PREFIX = "scenariorun";

/** How much of the digest an id carries. */
const DIGEST_LENGTH = 32;

/** What separates one digested field from the next: a byte no field can hold. */
const FIELD_SEPARATOR = "\u0000";

function digest(fields: readonly string[]): string {
  const hash = createHash("sha256");
  for (const field of fields) {
    hash.update(field);
    hash.update(FIELD_SEPARATOR);
  }

  return hash.digest("hex").slice(0, DIGEST_LENGTH);
}

/**
 * What the run covers, as the run service resolved it. Its targets arrive
 * canonically sorted, so the same request twice resolves to the same list.
 */
export type SuiteRunIdentity = {
  projectId: string;
  suiteId: string;
  idempotencyKey: string;
  activeScenarioIds: readonly string[];
  activeTargets: readonly SuiteTarget[];
  repeatCount: number;
  parameters?: SuiteRunParameters;
};

/**
 * The id the run is filed under. The configuration is digested beside the key
 * because nothing stores a receipt of a key: one sent again over a different
 * configuration names its own run rather than joining a batch that never counted it.
 */
export function deriveBatchRunId(identity: SuiteRunIdentity): string {
  return `${BATCH_RUN_ID_PREFIX}_${digest([
    identity.projectId,
    identity.suiteId,
    identity.idempotencyKey,
    identity.activeScenarioIds.join(","),
    identity.activeTargets.map((target) => targetKeyOf(target)).join(","),
    String(identity.repeatCount),
    identity.parameters ? canonicalParameters(identity.parameters) : "",
  ])}`;
}

/**
 * One item of a batch: one scenario, one slot of the canonical target list, one
 * repeat. The slot rather than the target's key, because a plan may hold the
 * same target twice and both occurrences are still two runs.
 */
export function deriveScenarioRunId(item: {
  batchRunId: string;
  scenarioId: string;
  targetSlot: number;
  repeat: number;
}): string {
  return `${SCENARIO_RUN_ID_PREFIX}_${digest([
    item.batchRunId,
    item.scenarioId,
    String(item.targetSlot),
    String(item.repeat),
  ])}`;
}
