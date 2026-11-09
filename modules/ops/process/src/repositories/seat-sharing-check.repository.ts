import type { SeatSharingCheck } from "@langwatch/ops-contract";

/**
 * The last seat sharing check, held for every process: the worker's daily run writes it,
 * the Cloud admin seat use page (/ops/cloud/seat-use) reads it.
 * Spec: modules/ops/specs/seat-sharing-check.feature
 */
export abstract class SeatSharingCheckRepository {
  abstract save(check: SeatSharingCheck): Promise<void>;
  /** Empty before the first check, or when the held value is in another shape. */
  abstract find(): Promise<SeatSharingCheck[]>;
}
