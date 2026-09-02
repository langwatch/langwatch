/**
 * The frame of the run plan dialog: its tab strip, the tab that is on screen,
 * and the line of actions at its foot.
 *
 * @see specs/features/agent-testing/run-plan-editor.feature
 */

import { Box, chakra, HStack, Skeleton, Text, VStack } from "@chakra-ui/react";
import { Play } from "lucide-react";
import { Dialog } from "@langwatch/workflow-web/components/ui/dialog";
import { describeError, FormServerError } from "../../../behavior/errors";
import { FG_MUTED, QUIET_BUTTON_SHADOW } from "../shared/design";
import { SmallButton } from "../shared/SmallButton";
import { PlanExecutionTab } from "./PlanExecutionTab";
import { PlanGeneralTab } from "./PlanGeneralTab";
import { PlanModelsTab } from "./PlanModelsTab";
import type { PlanEditorState } from "./usePlanEditor";

export type PlanTab = "general" | "models" | "execution";

export const PLAN_TABS: { id: PlanTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "models", label: "Simulation models" },
  { id: "execution", label: "Execution" },
];

/** The strip that names the three groups of questions. */
export function PlanModalTabs({
  tab,
  onTabChange,
}: {
  tab: PlanTab;
  onTabChange: (tab: PlanTab) => void;
}) {
  return (
    <HStack gap={1} paddingX={4} borderBottomWidth="1px" borderColor="border">
      {PLAN_TABS.map((entry) => (
        <chakra.button
          key={entry.id}
          type="button"
          onClick={() => onTabChange(entry.id)}
          aria-pressed={tab === entry.id}
          marginBottom="-1px"
          paddingX={2.5}
          paddingY={2}
          fontSize="12.5px"
          cursor="pointer"
          // The tab is a word with a line under it, so every piece of button
          // chrome the browser paints on its own is turned off by hand.
          appearance="none"
          background="transparent"
          borderRadius="0"
          boxShadow="none"
          borderWidth="0"
          borderStyle="solid"
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
  );
}

/** The tab that is on screen, or the skeleton a stored plan stands in as. */
export function PlanModalBody({
  editor,
  tab,
}: {
  editor: PlanEditorState;
  tab: PlanTab;
}) {
  if (editor.isLoading) return <PlanModalSkeleton />;

  if (editor.loadError) {
    return (
      <Text fontSize="12.5px" color="fg.error" data-testid="plan-modal-error">
        {describeError({ error: editor.loadError })}
      </Text>
    );
  }

  return (
    <VStack align="stretch" gap={4}>
      <FormServerError form={editor.suiteForm.form} />
      {tab === "general" && <PlanGeneralTab editor={editor} />}
      {tab === "models" && <PlanModelsTab editor={editor} />}
      {tab === "execution" && <PlanExecutionTab editor={editor} />}
    </VStack>
  );
}

/** Leave the dialog, write the plan, or write it and run it at once. */
export function PlanModalFooter({ editor }: { editor: PlanEditorState }) {
  return (
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
        boxShadow={QUIET_BUTTON_SHADOW}
        _hover={{ background: "bg.muted", color: "fg" }}
      >
        Cancel
      </chakra.button>
      <SmallButton
        loading={editor.isSaving}
        disabled={!!editor.loadError}
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
        disabled={!!editor.loadError}
        onClick={editor.save}
        data-testid="plan-modal-save"
      >
        {editor.isEditing ? "Save" : "Create run plan"}
      </SmallButton>
    </Dialog.Footer>
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
