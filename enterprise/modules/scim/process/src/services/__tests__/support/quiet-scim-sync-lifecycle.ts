// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ScimSyncLifecycle } from "../../scim-sync-lifecycle.service.ts";

/** Existing characterization suites do not exercise the eventing adapter. */
export class QuietScimSyncLifecycle implements ScimSyncLifecycle {
  async tokenIssued(): Promise<void> {}
  async userPushed(): Promise<void> {}
  async groupMapped(): Promise<void> {}
  async applyFailed(): Promise<void> {}
  async applyRedriven(): Promise<void> {}
  async revoked(): Promise<void> {}
}

/** Records each user push, so a suite can read what a push said it changed. */
export class RecordingScimSyncLifecycle implements ScimSyncLifecycle {
  readonly pushes: Parameters<ScimSyncLifecycle["userPushed"]>[0][] = [];

  async userPushed(push: Parameters<ScimSyncLifecycle["userPushed"]>[0]): Promise<void> {
    this.pushes.push(push);
  }
  async tokenIssued(): Promise<void> {}
  async groupMapped(): Promise<void> {}
  async applyFailed(): Promise<void> {}
  async applyRedriven(): Promise<void> {}
  async revoked(): Promise<void> {}
}
