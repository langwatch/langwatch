/**
 * Write or edit one run plan, in one dialog.
 *
 * The dialog asks three groups of questions behind a tab strip: what the plan
 * is and what runs, which models play the user and the judge, and how the run
 * is executed. A test suite is a run plan whose scope is fixed, so it reads
 * the same dialog with its case list stated rather than picked.
 *
 * @see specs/features/agent-testing/run-plan-editor.feature
 */

import { useEffect, useState } from "react";
import { Dialog } from "@langwatch/workflow-web/components/ui/dialog";
import type { SimulationSuite } from "../../../model/prisma-types";
import {
  PlanModalBody,
  PlanModalFooter,
  PlanModalTabs,
  type PlanTab,
} from "./PlanModalParts";
import { usePlanEditor } from "./usePlanEditor";

/**
 * The callbacks the page hands the editor through the flow registry. They are
 * declared here because the registry reads a drawer's callbacks off its props.
 */
export type PlanModalProps = {
  onSaved?: (suite: SimulationSuite) => void;
  onRunRequested?: (suite: SimulationSuite) => void;
};

/** What the dialog is called, given the plan it has open. */
function planModalTitle(editor: ReturnType<typeof usePlanEditor>): string {
  if (editor.isFixedScope) return "Edit test suite";
  return editor.isEditing ? "Edit run plan" : "New run plan";
}

export function PlanModal(_props: PlanModalProps) {
  const editor = usePlanEditor();
  const [tab, setTab] = useState<PlanTab>("general");

  // Every open starts on the first question, whichever tab the last edit left.
  useEffect(() => {
    if (editor.isOpen) setTab("general");
  }, [editor.isOpen]);

  return (
    <Dialog.Root
      open={editor.isOpen}
      onOpenChange={({ open }) => {
        if (!open) editor.close();
      }}
      placement="center"
    >
      <Dialog.Content bg="bg.panel" maxWidth="580px" data-testid="plan-modal">
        <Dialog.Header
          borderBottomWidth="1px"
          borderColor="border"
          paddingX={5}
          paddingY={3.5}
          display="block"
        >
          <Dialog.Title fontSize="14px" fontWeight="semibold">
            {planModalTitle(editor)}
          </Dialog.Title>
          <Dialog.CloseTrigger />
        </Dialog.Header>

        <PlanModalTabs tab={tab} onTabChange={setTab} />

        <Dialog.Body
          paddingX={5}
          paddingY={4}
          minHeight="268px"
          maxHeight="54vh"
          overflowY="auto"
        >
          <PlanModalBody editor={editor} tab={tab} />
        </Dialog.Body>

        <PlanModalFooter editor={editor} />
      </Dialog.Content>
    </Dialog.Root>
  );
}

export default PlanModal;
