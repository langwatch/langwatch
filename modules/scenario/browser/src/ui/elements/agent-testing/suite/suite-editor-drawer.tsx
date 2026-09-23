/**
 * Edit one test suite in a URL-routed right-side drawer. Picking or editing an evaluator navigates
 * to its drawer and back, with the draft held in the suite editor store meanwhile.
 * @see specs/features/agent-testing/suite-editor.feature
 * @see dev/docs/best_practices/drawers.md
 */

import { Box, Input, Skeleton, Text, VStack } from "@chakra-ui/react";
import { useDrawer, useDrawerParams } from "@langwatch/browser-host/drawer";
import { Drawer } from "@langwatch/design-system/drawer";

import { FG_MUTED } from "../../../../model/agent-testing/shared/design.ts";
import {
  CASE_EDITOR_DRAWER_SIZE,
  SUITE_EDITOR_DRAWER,
} from "../../../sections/agent-testing/cases/drawer-keys.ts";
import { CustomizeChips } from "../shared/customize-chips.tsx";
import { DIALOG_FIELD_STYLE, FieldError, FieldLabel } from "../shared/dialog-fields.tsx";
import { SmallButton } from "../shared/small-button.tsx";
import { SuiteEvaluatorsSection } from "./suite-evaluators-section.tsx";
import { SuiteFieldsSection } from "./suite-fields-section.tsx";
import { type SuiteEditorModel, useSuiteEditor } from "./use-suite-editor.ts";

export { SUITE_EDITOR_DRAWER };

/** The props the drawer accepts at open time; the id survives a reload. */
export type SuiteEditorDrawerProps = {
  testSuiteId?: string;
};

const SUITE_EDITOR_SUBTITLE = "The fields its scenarios carry, and the checks every run in it gets";

function SuiteEditorHeader({ storedName }: { storedName: string }) {
  return (
    <Drawer.Header
      borderBottomWidth="1px"
      borderColor="border"
      paddingX={5}
      paddingY={3.5}
      display="block"
    >
      <Drawer.Title fontSize="14px" fontWeight="semibold">
        Edit test suite
      </Drawer.Title>
      <Text fontSize="12px" color={FG_MUTED} marginTop={0.5}>
        {storedName || SUITE_EDITOR_SUBTITLE}
      </Text>
      <Drawer.CloseTrigger />
    </Drawer.Header>
  );
}

/** Stands in for the form while the stored suite is being read. */
function SuiteEditorSkeleton() {
  return (
    <VStack align="stretch" gap={4} data-testid="suite-editor-skeleton">
      <Skeleton height="46px" />
      <Skeleton height="92px" />
    </VStack>
  );
}

/** The name, the open sections, and the chips pinned to the foot. */
function SuiteEditorFields({ model }: { model: SuiteEditorModel }) {
  const { draft } = model;
  if (model.isLoading || !draft) return <SuiteEditorSkeleton />;

  return (
    <VStack align="stretch" gap={5} minHeight="full">
      <Box>
        <FieldLabel>Name</FieldLabel>
        <Input
          {...DIALOG_FIELD_STYLE}
          autoFocus
          aria-label="Test suite name"
          placeholder="Case lookups"
          value={draft.name}
          onChange={(event) => model.setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              model.save();
            }
          }}
        />
        <FieldError message={draft.nameError} />
      </Box>

      {draft.showFields && (
        <SuiteFieldsSection
          rows={draft.fields}
          error={draft.fieldsError}
          onPatch={model.fields.patch}
          onReorder={model.fields.reorder}
          onRemove={model.fields.remove}
          onAdd={model.fields.add}
          onClose={model.fields.close}
        />
      )}

      {draft.showEvaluators && (
        <SuiteEvaluatorsSection
          attachments={draft.evaluators}
          evaluatorsById={model.evaluators.evaluatorsById}
          missingOf={model.evaluators.missingOf}
          error={draft.evaluatorsError}
          onEdit={model.evaluators.edit}
          onAdd={model.evaluators.add}
          onClose={model.evaluators.close}
        />
      )}

      {/* The chip row alone is pinned to the bottom of the scroll area, the
          way the scenario editor pins its own. */}
      <Box marginTop="auto">
        <CustomizeChips
          title="Customize test suite"
          chips={model.chips}
          testId="customize-suite-chips"
        />
      </Box>
    </VStack>
  );
}

function SuiteEditorFooter({ model }: { model: SuiteEditorModel }) {
  return (
    <Drawer.Footer
      borderTopWidth="1px"
      borderColor="border"
      paddingX={5}
      paddingY={3}
      justifyContent="flex-end"
      gap={2}
    >
      <SmallButton onClick={model.close} data-testid="suite-editor-cancel">
        Cancel
      </SmallButton>
      <SmallButton
        variant="solid"
        colorPalette="blue"
        loading={model.isSaving}
        disabled={model.isLoading}
        onClick={model.save}
        data-testid="suite-editor-save"
      >
        Save
      </SmallButton>
    </Drawer.Footer>
  );
}

export function SuiteEditorDrawer(_props: SuiteEditorDrawerProps) {
  const { drawerOpen } = useDrawer();
  const params = useDrawerParams();
  const isOpen = drawerOpen(SUITE_EDITOR_DRAWER);
  const testSuiteId = params.testSuiteId ?? null;

  const model = useSuiteEditor({ testSuiteId, isOpen });

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open: nextOpen }) => !nextOpen && model.close()}
      placement="end"
      size={CASE_EDITOR_DRAWER_SIZE}
    >
      <Drawer.Content bg="bg.panel" data-testid="suite-editor">
        <SuiteEditorHeader storedName={model.storedName} />
        <Drawer.Body paddingX={5} paddingY={4} overflowY="auto">
          <SuiteEditorFields model={model} />
        </Drawer.Body>
        <SuiteEditorFooter model={model} />
      </Drawer.Content>
    </Drawer.Root>
  );
}

export default SuiteEditorDrawer;
