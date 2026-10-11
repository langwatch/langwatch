/**
 * @see specs/features/agent-testing/cases-table.feature
 * @see dev/docs/best_practices/selection-action-bar.md
 */

import { Dialog } from "@langwatch/design-system/dialog";
import { NativeSelect, Text, VStack } from "@langwatch/design-system/primitives";
import { SelectionActionBar } from "@langwatch/design-system/selection-action-bar";
import { Folder } from "lucide-react";
import { useEffect, useState } from "react";

import type { TestSuiteEntry } from "../../../../model/agent-testing/cases/test-cases.ts";
import { SmallButton } from "../../../elements/agent-testing/shared/small-button.tsx";

export type MoveToSuiteSelectionBarProps = {
  selectedCount: number;
  suites: TestSuiteEntry[];
  onClear: () => void;
  onConfirm: (targetSuiteId: string) => void;
};

export function MoveToSuiteSelectionBar({
  selectedCount,
  suites,
  onClear,
  onConfirm,
}: MoveToSuiteSelectionBarProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  if (selectedCount === 0) return null;

  return (
    <>
      <SelectionActionBar
        label={`${selectedCount} selected`}
        onClear={onClear}
        testId="cases-selection-action-bar"
      >
        <SmallButton
          variant="solid"
          colorPalette="orange"
          onClick={() => setIsDialogOpen(true)}
          data-testid="cases-selection-move-to-suite"
        >
          <Folder size={13} />
          Move to suite
        </SmallButton>
      </SelectionActionBar>
      <MoveToSuiteDialog
        open={isDialogOpen}
        selectedCount={selectedCount}
        suites={suites}
        onCancel={() => setIsDialogOpen(false)}
        onConfirm={(target) => {
          setIsDialogOpen(false);
          onConfirm(target);
        }}
      />
    </>
  );
}

function MoveToSuiteDialog({
  open,
  selectedCount,
  suites,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  selectedCount: number;
  suites: TestSuiteEntry[];
  onCancel: () => void;
  onConfirm: (targetSuiteId: string) => void;
}) {
  const firstSuiteId = suites[0]?.id ?? "";
  const [value, setValue] = useState<string>(firstSuiteId);

  useEffect(() => {
    if (open) setValue(firstSuiteId);
  }, [open, firstSuiteId]);

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title="Move to test suite"
      size="sm"
      placement="center"
      primaryAction={{
        label: "Move",
        onClick: () => onConfirm(value),
        ...(value ? {} : { disabledReason: "This project has no test suite to move to." }),
        "data-testid": "cases-move-to-suite-confirm",
      }}
      data-testid="cases-move-to-suite-dialog"
    >
      <VStack align="stretch" gap={3}>
        <Text textStyle="caption" color="fg.muted">
          Move {selectedCount === 1 ? "1 scenario" : `${selectedCount} scenarios`} to
        </Text>
        <NativeSelect.Root size="sm">
          <NativeSelect.Field
            aria-label="Target test suite"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            data-testid="cases-move-to-suite-select"
          >
            {suites.map((suite) => (
              <option key={suite.id} value={suite.id}>
                {suite.name}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </VStack>
    </Dialog>
  );
}
