// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { ScimSyncLifecyclePort } from "../../scim-sync-lifecycle.port";

/** Existing characterization suites do not exercise the eventing adapter. */
export class QuietScimSyncLifecycle extends ScimSyncLifecyclePort {
  async tokenIssued(): Promise<void> {}
  async userPushed(): Promise<void> {}
  async groupMapped(): Promise<void> {}
  async applyFailed(): Promise<void> {}
  async revoked(): Promise<void> {}
}
