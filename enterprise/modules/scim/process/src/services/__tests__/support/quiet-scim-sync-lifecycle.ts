// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ScimSyncLifecycle } from "../../../app/scim.members.ts";

/** Existing characterization suites do not exercise the eventing adapter. */
export class QuietScimSyncLifecycle implements ScimSyncLifecycle {
  async tokenIssued(): Promise<void> {}
  async userPushed(): Promise<void> {}
  async groupMapped(): Promise<void> {}
  async applyFailed(): Promise<void> {}
  async applyRedriven(): Promise<void> {}
  async revoked(): Promise<void> {}
}
