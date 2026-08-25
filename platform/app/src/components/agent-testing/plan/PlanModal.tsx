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

import { Box, HStack, Skeleton, Text, VStack, chakra } from "@chakra-ui/react";
import { Play } from "lucide-react";
import { useEffect, useState } from "react";
import { AgentHttpEditorDrawer } from "~/components/agents/AgentHttpEditorDrawer";
import { ScenarioFormDrawer } from "~/components/scenarios/ScenarioFormDrawer";
import { Dialog } from "~/components/ui/dialog";
import { FormServerError } from "~/features/errors";
import type { SimulationSuite } from "~/generated/prisma/client";
import { FG_MUTED } from "../shared/design";
import { SmallButton } from "../shared/SmallButton";
import { PlanExecutionTab } from "./PlanExecutionTab";
import { PlanGeneralTab } from "./PlanGeneralTab";
import { PlanModelsTab } from "./PlanModelsTab";
import { usePlanEditor } from "./usePlanEditor";

type PlanTab = "general" | "models" | "execution";

const PLAN_TABS: { id: PlanTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "models", label: "Simulation models" },
  { id: "execution", label: "Execution" },
];

/**
 * The callbacks the page hands the editor through the flow registry. They are
 * declared here because the registry reads a drawer's callbacks off its props.
 */
export type PlanModalProps = {
  onSaved?: (suite: SimulationSuite) => void;
  onRunRequested?: (suite: SimulationSuite) => void;
};

export function PlanModal(_props: PlanModalProps) {
  const editor = usePlanEditor();
  const [tab, setTab] = useState<PlanTab>("general");
  const [isCaseEditorOpen, setCaseEditorOpen] = useState(false);
  const [isAgentEditorOpen, setAgentEditorOpen] = useState(false);

  // Every open starts on the first question, whichever tab the last edit left.
  useEffect(() => {
    if (editor.isOpen) setTab("general");
  }, [editor.isOpen]);

  const title = editor.isFixedScope
    ? "Edit test suite"
    : editor.isEditing
      ? "Edit run plan"
      : "New run plan";

  return (
    <>
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
              {title}
            </Dialog.Title>
            <Dialog.CloseTrigger />
          </Dialog.Header>

          <HStack
            gap={1}
            paddingX={4}
            borderBottomWidth="1px"
            borderColor="border"
          >
            {PLAN_TABS.map((entry) => (
              <chakra.button
                key={entry.id}
                type="button"
                onClick={() => setTab(entry.id)}
                aria-pressed={tab === entry.id}
                marginBottom="-1px"
                paddingX={2.5}
                paddingY={2}
                fontSize="12.5px"
                cursor="pointer"
                borderBottomWidth="2px"
                borderBottomColor={tab === entry.id ? "fg" : "transparent"}
                fontWeight={tab === entry.id ? "medium" : "normal"}
                color={tab === entry.id ? "fg" : FG_MUTED}
                _hover={{ color: "fg" }}
                data-testid={`plan-modal-tab-${entry.id}`}
              >
                {entry.label}
              </chakra.button>
            ))}
          </HStack>

          <Dialog.Body
            paddingX={5}
            paddingY={4}
            minHeight="268px"
            maxHeight="54vh"
            overflowY="auto"
          >
            {editor.isLoading ? (
              <PlanModalSkeleton />
            ) : (
              <VStack align="stretch" gap={4}>
                <FormServerError form={editor.suiteForm.form} />
                {tab === "general" && (
                  <PlanGeneralTab
                    editor={editor}
                    onNewTestCase={() => setCaseEditorOpen(true)}
                  />
                )}
                {tab === "models" && <PlanModelsTab editor={editor} />}
                {tab === "execution" && (
                  <PlanExecutionTab
                    editor={editor}
                    onAddTarget={() => setAgentEditorOpen(true)}
                  />
                )}
              </VStack>
            )}
          </Dialog.Body>

          <Dialog.Footer
            borderTopWidth="1px"
            borderColor="border"
            paddingX={5}
            paddingY={3}
            gap={2}
          >
            <Box flex={1} />
            <chakra.button
              type="button"
              onClick={editor.close}
              paddingX={3}
              height="28px"
              borderRadius="lg"
              fontSize="12px"
              fontWeight="medium"
              color={FG_MUTED}
              cursor="pointer"
              _hover={{ background: "bg.muted", color: "fg" }}
            >
              Cancel
            </chakra.button>
            <SmallButton
              loading={editor.isSaving}
              onClick={editor.saveAndRun}
              data-testid="plan-modal-save-and-run"
            >
              <Play size={13} />
              Save &amp; Run
            </SmallButton>
            <SmallButton
              variant="solid"
              colorPalette="blue"
              background={undefined}
              borderColor="transparent"
              loading={editor.isSaving}
              onClick={editor.save}
              data-testid="plan-modal-save"
            >
              {editor.isEditing ? "Save" : "Create run plan"}
            </SmallButton>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>

      {/* Both are only mounted once asked for: each carries its own form. */}
      {isCaseEditorOpen && (
        <ScenarioFormDrawer
          open
          onClose={() => setCaseEditorOpen(false)}
        />
      )}
      {isAgentEditorOpen && (
        <AgentHttpEditorDrawer
          open
          onClose={() => setAgentEditorOpen(false)}
        />
      )}
    </>
  );
}

/** Stands in for the form while a stored plan is being read. */
function PlanModalSkeleton() {
  return (
    <VStack align="stretch" gap={4} data-testid="plan-modal-skeleton">
      <Skeleton height="46px" />
      <Skeleton height="60px" />
      <Skeleton height="120px" />
      <Text srOnly>Loading the run plan</Text>
    </VStack>
  );
}

export default PlanModal;
