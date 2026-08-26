/**
 * Write or edit one run plan, in a right-side drawer.
 *
 * The drawer asks three groups of questions behind a tab strip: what the plan
 * is and what runs, which models play the user and the judge, and how the run
 * is executed. A test suite is a run plan whose scope is fixed, so it reads
 * the same drawer with its case list stated rather than picked.
 *
 * The drawer is URL routed, so a shared link opens the same run plan editor,
 * and a Save & Run leaves the drawer through the standard drawer navigation
 * rather than a hand-rolled dialog dismiss.
 *
 * @see specs/features/agent-testing/run-plan-editor.feature
 * @see dev/docs/best_practices/drawers.md
 */

import { useEffect, useState } from "react";
import { Drawer } from "~/components/ui/drawer";
import type { SimulationSuite } from "~/generated/prisma/client";
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

/** What the drawer is called, given the plan it has open. */
function planDrawerTitle(editor: ReturnType<typeof usePlanEditor>): string {
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
    <Drawer.Root
      open={editor.isOpen}
      onOpenChange={({ open }) => {
        if (!open) editor.close();
      }}
      placement="end"
      size="md"
    >
      <Drawer.Content bg="bg.panel" data-testid="plan-modal">
        <Drawer.Header
          borderBottomWidth="1px"
          borderColor="border"
          paddingX={5}
          paddingY={3.5}
          display="block"
        >
          <Drawer.Title fontSize="14px" fontWeight="semibold">
            {planDrawerTitle(editor)}
          </Drawer.Title>
          <Drawer.CloseTrigger />
        </Drawer.Header>

        <PlanModalTabs tab={tab} onTabChange={setTab} />

        <Drawer.Body paddingX={5} paddingY={4} overflowY="auto">
          <PlanModalBody editor={editor} tab={tab} />
        </Drawer.Body>

        <PlanModalFooter editor={editor} />
      </Drawer.Content>
    </Drawer.Root>
  );
}

export default PlanModal;
