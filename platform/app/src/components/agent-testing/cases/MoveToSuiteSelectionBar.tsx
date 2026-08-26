/**
 * @see specs/features/agent-testing/cases-table.feature
 * @see dev/docs/best_practices/selection-action-bar.md
 */

import { Box, chakra, NativeSelect, Text, VStack } from "@chakra-ui/react";
import { Folder } from "lucide-react";
import { useEffect, useState } from "react";
import { UNFILED_OPTION_LABEL } from "~/components/scenarios/ScenarioForm";
import { Dialog } from "~/components/ui/dialog";
import { SelectionActionBar } from "~/components/ui/SelectionActionBar";
import { FG_MUTED, QUIET_BUTTON_SHADOW } from "../shared/design";
import { SmallButton } from "../shared/SmallButton";
import type { TestSuiteEntry } from "./test-cases";

// Distinct from any real suite id: `null` is the wire value for the unfile
// target, and a `Select` cannot carry `null` as an option value.
const UNFILED_VALUE = "__unfiled__";

export type MoveToSuiteSelectionBarProps = {
  selectedCount: number;
  suites: TestSuiteEntry[];
  onClear: () => void;
  onConfirm: (targetSuiteId: string | null) => void;
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
          colorPalette="blue"
          background={undefined}
          borderColor="transparent"
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
  onConfirm: (targetSuiteId: string | null) => void;
}) {
  const [value, setValue] = useState<string>(UNFILED_VALUE);

  useEffect(() => {
    if (open) setValue(UNFILED_VALUE);
  }, [open]);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={({ open: nextOpen }) => !nextOpen && onCancel()}
      placement="center"
    >
      <Dialog.Content
        bg="bg.panel"
        maxWidth="420px"
        data-testid="cases-move-to-suite-dialog"
      >
        <Dialog.Header
          borderBottomWidth="1px"
          borderColor="border"
          paddingX={5}
          paddingY={3.5}
        >
          <Dialog.Title fontSize="14px" fontWeight="semibold">
            Move to test suite
          </Dialog.Title>
          <Dialog.CloseTrigger />
        </Dialog.Header>
        <Dialog.Body paddingX={5} paddingY={4}>
          <VStack align="stretch" gap={3}>
            <Text fontSize="12px" color={FG_MUTED}>
              Move{" "}
              {selectedCount === 1
                ? "1 test case"
                : `${selectedCount} test cases`}{" "}
              to
            </Text>
            <NativeSelect.Root size="sm">
              <NativeSelect.Field
                aria-label="Target test suite"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                data-testid="cases-move-to-suite-select"
              >
                <option value={UNFILED_VALUE}>{UNFILED_OPTION_LABEL}</option>
                {suites.map((suite) => (
                  <option key={suite.id} value={suite.id}>
                    {suite.name}
                  </option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </VStack>
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
            onClick={onCancel}
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
            variant="solid"
            colorPalette="blue"
            background={undefined}
            borderColor="transparent"
            onClick={() => onConfirm(value === UNFILED_VALUE ? null : value)}
            data-testid="cases-move-to-suite-confirm"
          >
            Move
          </SmallButton>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
