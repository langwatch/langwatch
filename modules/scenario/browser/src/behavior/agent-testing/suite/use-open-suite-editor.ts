/**
 * Opens the suite editor on one test suite, from any of its ways in: the Edit suite button, the
 * rail row menu, and the chips under the suite name. A fresh open drops any earlier draft; a pill
 * may ask for one attachment's editor, which the drawer opens once it has the draft.
 * @see specs/features/agent-testing/suite-editor.feature
 */

import { useDrawer } from "@langwatch/browser-host/drawer";
import { useCallback } from "react";

import { useSuiteEditorStore } from "./suite-editor-store.ts";

export type OpenSuiteEditorParams = {
  testSuiteId: string;
  /** The attachment to open the evaluator editor on, once the drawer is up. */
  attachmentId?: string;
};

export function useOpenSuiteEditor(): (params: OpenSuiteEditorParams) => void {
  const { openDrawer } = useDrawer();

  return useCallback(
    ({ testSuiteId, attachmentId }: OpenSuiteEditorParams) => {
      const store = useSuiteEditorStore.getState();
      store.clear();
      store.setPendingAttachmentId(attachmentId ?? null);
      openDrawer("agentTestingSuiteEditor", { testSuiteId });
    },
    [openDrawer],
  );
}
