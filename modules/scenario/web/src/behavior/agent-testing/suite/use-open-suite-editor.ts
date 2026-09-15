/**
 * Opens the suite editor on one test suite, from any of its ways in: the Edit suite button, the
 * rail row menu, and the chips under the suite name. A pill may also ask for one attachment's
 * editor; the attachment id travels as a URL param so a follow-up visit can restore focus on it.
 * @see specs/features/agent-testing/suite-editor.feature
 */

import { useCallback } from "react";
import { useDrawer } from "@langwatch/ui-drawer";

export type OpenSuiteEditorParams = {
  testSuiteId: string;
  /** The attachment to open the evaluator editor on, once the drawer is up. */
  attachmentId?: string;
};

export function useOpenSuiteEditor(): (params: OpenSuiteEditorParams) => void {
  const { openDrawer } = useDrawer();

  return useCallback(
    ({ testSuiteId, attachmentId }: OpenSuiteEditorParams) => {
      openDrawer("suiteEditor", {
        urlParams: attachmentId
          ? { suiteId: testSuiteId, attachmentId }
          : { suiteId: testSuiteId },
      });
    },
    [openDrawer],
  );
}
