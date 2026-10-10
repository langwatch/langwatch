import { z } from "zod";

export const cloudLatestReleaseSchema = z.object({
  release: z.string(),
  commit: z.string().nullable(),
});

/** The newest release cloud named in its last usage-report reply (U8-Q-U3). */
export type CloudLatestRelease = z.infer<typeof cloudLatestReleaseSchema>;

/**
 * The install's one held answer: the worker's report writes it, every process's Upgrades read
 * reads it. Saving null forgets it. Spec: modules/ops/specs/upgrades.feature
 */
export abstract class CloudLatestReleaseRepository {
  abstract save(latest: CloudLatestRelease | null): Promise<void>;
  /** Empty when no reply named one, or the held value is in another shape. */
  abstract find(): Promise<CloudLatestRelease[]>;
}
