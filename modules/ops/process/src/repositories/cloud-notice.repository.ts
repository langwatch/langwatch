import type { SelfHostedNotice } from "@langwatch/ops-contract";

/**
 * The notices cloud named in its last usage-report reply, kept beside the latest release: the
 * worker's report writes them, every process's Upgrades read reads them. Saving none forgets
 * them. Spec: modules/ops/specs/self-hosted-notices.feature
 */
export abstract class CloudNoticeRepository {
  abstract save(notices: readonly SelfHostedNotice[]): Promise<void>;
  /** Empty when no reply named one; a held notice in another shape is dropped. */
  abstract find(): Promise<SelfHostedNotice[]>;
}
