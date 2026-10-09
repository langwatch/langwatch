/**
 * Opens the suite editor on one test suite, from any of its ways in: the
 * Edit suite button, the rail row menu, and the chips under the suite name.
 *
 * A fresh open starts from the stored suite, so whatever draft an earlier
 * visit left behind is dropped first. A pill may also ask for one
 * attachment's editor, which the drawer opens as soon as it has the draft.
 *
 * @see specs/features/agent-testing/suite-editor.feature
 */

import { useCallback } from "react";
import { useDrawer } from "~/hooks/useDrawer";
import { SUITE_EDITOR_DRAWER } from "../cases/drawerKeys";
import { useSuiteEditorStore } from "./suiteEditorStore";

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
      openDrawer(SUITE_EDITOR_DRAWER, { testSuiteId });
    },
    [openDrawer],
  );
}
