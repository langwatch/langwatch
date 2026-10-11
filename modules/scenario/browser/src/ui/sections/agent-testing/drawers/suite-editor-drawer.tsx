/**
 * Edit one test suite in a URL-routed right-side drawer. Picking or editing an evaluator navigates
 * to its drawer and back, with the draft held in the suite editor store meanwhile.
 * @see specs/features/agent-testing/suite-editor.feature
 * @see dev/docs/best_practices/drawers.md
 */

import { useDrawer, useDrawerParams } from "@langwatch/browser-host/drawer";
import { Drawer } from "@langwatch/design-system/drawer";
import { Box, Input, Skeleton, VStack } from "@langwatch/design-system/primitives";

import { useFocusOnMount } from "../../../../behavior/use-focus-on-mount.ts";
import { SUITE_EDITOR_DRAWER } from "../../../../model/agent-testing/cases/drawer-keys.ts";
import { CustomizeChips } from "../../../elements/agent-testing/shared/customize-chips.tsx";
import {
  DIALOG_FIELD_STYLE,
  FieldError,
  FieldLabel,
} from "../../../elements/agent-testing/shared/dialog-fields.tsx";
import { SuiteEvaluatorsSection } from "../../../elements/agent-testing/suite/suite-evaluators-section.tsx";
import { SuiteFieldsSection } from "../../../elements/agent-testing/suite/suite-fields-section.tsx";
import { type SuiteEditorModel, useSuiteEditor } from "../suite/use-suite-editor.ts";

export { SUITE_EDITOR_DRAWER };

/** The props the drawer accepts at open time; the id survives a reload. */
export type SuiteEditorDrawerProps = {
  testSuiteId?: string;
};

const SUITE_EDITOR_SUBTITLE = "The fields its scenarios carry, and the checks every run in it gets";

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

  const nameRef = useFocusOnMount<HTMLInputElement>();

  return (
    <VStack align="stretch" gap={5} minHeight="full">
      <Box>
        <FieldLabel>Name</FieldLabel>
        <Input
          {...DIALOG_FIELD_STYLE}
          ref={nameRef}
          aria-label="Test suite name"
          data-testid="suite-editor-name-input"
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

export function SuiteEditorDrawer(_props: SuiteEditorDrawerProps) {
  const { drawerOpen } = useDrawer();
  const params = useDrawerParams();
  const isOpen = drawerOpen(SUITE_EDITOR_DRAWER);
  const testSuiteId = params.testSuiteId ?? null;

  const model = useSuiteEditor({ testSuiteId, isOpen });

  return (
    <Drawer
      open={isOpen}
      onClose={model.close}
      size="detail"
      title="Edit test suite"
      subtitle={model.storedName || SUITE_EDITOR_SUBTITLE}
      footer={{
        cancel: { onClick: model.close },
        busy: model.isSaving,
        primaryAction: {
          label: "Save",
          loading: model.isSaving,
          disabledReason: model.isLoading ? "The test suite is still loading." : void 0,
          onClick: model.save,
          "data-testid": "suite-editor-save",
        },
      }}
      data-testid="suite-editor"
    >
      <SuiteEditorFields model={model} />
    </Drawer>
  );
}

export default SuiteEditorDrawer;
