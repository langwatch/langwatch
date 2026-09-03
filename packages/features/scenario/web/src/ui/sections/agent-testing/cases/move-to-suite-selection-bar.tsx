/**
 * @see specs/features/agent-testing/cases-table.feature
 * @see dev/docs/best_practices/selection-action-bar.md
 */

import { Box, chakra, NativeSelect, Text, VStack } from "@chakra-ui/react";
import { Folder } from "lucide-react";
import { useEffect, useState } from "react";
import { Dialog } from "@langwatch/workflow-web/components/ui/dialog";
import { SelectionActionBar } from "@langwatch/trace-web";
import { FG_MUTED, QUIET_BUTTON_SHADOW } from "../../../../model/agent-testing/shared/design";
import { SmallButton } from "../../../elements/agent-testing/shared/small-button";
import type { TestSuiteEntry } from "../../../../model/agent-testing/cases/test-cases";

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
          colorPalette="blue"
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
    <Dialog.Root
      open={open}
      onOpenChange={({ open: nextOpen }) => !nextOpen && onCancel()}
      placement="center"
    >
      <Dialog.Content bg="bg.panel" maxWidth="420px" data-testid="cases-move-to-suite-dialog">
        <Dialog.Header borderBottomWidth="1px" borderColor="border" paddingX={5} paddingY={3.5}>
          <Dialog.Title fontSize="14px" fontWeight="semibold">
            Move to test suite
          </Dialog.Title>
          <Dialog.CloseTrigger />
        </Dialog.Header>
        <Dialog.Body paddingX={5} paddingY={4}>
          <VStack align="stretch" gap={3}>
            <Text fontSize="12px" color={FG_MUTED}>
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
        </Dialog.Body>
        <Dialog.Footer borderTopWidth="1px" borderColor="border" paddingX={5} paddingY={3} gap={2}>
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
            disabled={!value}
            onClick={() => onConfirm(value)}
            data-testid="cases-move-to-suite-confirm"
          >
            Move
          </SmallButton>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
