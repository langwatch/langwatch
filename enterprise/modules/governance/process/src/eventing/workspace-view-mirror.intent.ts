// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { ProcessStore } from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import type { WorkspaceViewMirrorOutbox } from "../services/admin-workspace-view-audit.service.ts";
import {
  WORKSPACE_VIEW_MIRROR_INTENT,
  WORKSPACE_VIEW_MIRROR_PROCESS_KEY,
  WORKSPACE_VIEW_MIRROR_PROCESS_NAME,
  WORKSPACE_VIEW_MIRROR_RETENTION_MS,
  type WorkspaceViewMirrorIntent,
  workspaceViewMirrorKey,
} from "./workspace-view-mirror.process.ts";

/** The daily prune of mirrored intents. */
export function pruneWorkspaceViewMirrors(
  retention: Pick<ProcessStore, "deleteDispatchedBefore">,
): () => Promise<void> {
  return async () => {
    await retention.deleteDispatchedBefore({
      processName: WORKSPACE_VIEW_MIRROR_PROCESS_NAME,
      before: nowInstant().epochMilliseconds - WORKSPACE_VIEW_MIRROR_RETENTION_MS,
    });
  };
}

/** The request's side: the mirror intent appended to governance's own outbox, keyed once per row. */
export class OutboxWorkspaceViewMirror implements WorkspaceViewMirrorOutbox {
  static create(processStore: Pick<ProcessStore, "appendIntents">): OutboxWorkspaceViewMirror {
    return new OutboxWorkspaceViewMirror(processStore);
  }

  private constructor(private readonly processStore: Pick<ProcessStore, "appendIntents">) {}

  async record(intent: WorkspaceViewMirrorIntent): Promise<void> {
    await this.processStore.appendIntents({
      ref: {
        processName: WORKSPACE_VIEW_MIRROR_PROCESS_NAME,
        projectId: intent.organizationId,
        processKey: WORKSPACE_VIEW_MIRROR_PROCESS_KEY,
      },
      tenantId: intent.organizationId,
      sourceEventId: null,
      messages: [
        {
          messageKey: workspaceViewMirrorKey(intent),
          intentType: WORKSPACE_VIEW_MIRROR_INTENT,
          payload: { ...intent },
          traceCarrier: {},
        },
      ],
      now: nowInstant().epochMilliseconds,
    });
  }
}
