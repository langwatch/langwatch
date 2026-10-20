import { Card } from "@langwatch/design-system/card";
import { RawCheckbox as Checkbox } from "@langwatch/design-system/checkbox";
import { Dialog } from "@langwatch/design-system/dialog";
import { HStack, Icon, Text, VStack } from "@langwatch/design-system/primitives";
import type React from "react";
import { useState } from "react";
import { LuColumns3, LuMoveHorizontal } from "react-icons/lu";

import { useColumnEducationStore } from "../../../../features/explorer/behavior/column-education.store.ts";

/**
 * One-off teaching dialog that fires the first time the operator tries to drag a column
 * header in the v2 trace table.
 */
export const ColumnEducationDialog: React.FC = () => {
  const isOpen = useColumnEducationStore((s) => s.isOpen);
  const dismiss = useColumnEducationStore((s) => s.dismiss);
  const [dontShowAgain, setDontShowAgain] = useState(true);

  return (
    <Dialog
      open={isOpen}
      onClose={() => dismiss(dontShowAgain)}
      placement="center"
      size="md"
      title="Reorder columns"
      errorScope="ColumnEducationDialog"
      cancelLabel={null}
      primaryAction={{ label: "Got it", onClick: () => dismiss(dontShowAgain) }}
    >
      <VStack align="stretch" gap={4}>
        <Text textStyle="sm" color="fg">
          You can drag columns to reorder them, but the drag handle lives on the small grip icon at
          the <b>left of each column header</b>, not on the header itself. Dragging anywhere else on
          the header just selects text.
        </Text>
        <Text textStyle="sm" color="fg.muted">
          To change which columns appear, use the <b>Columns</b>
          dropdown in the toolbar.
        </Text>

        {/* CSS-illustrated preview of the column picker. Tracks the
            live design tokens so the hint always matches the real
            surface; no PNG to keep in sync. */}
        <Card variant="nested" padding="sm">
          <HStack
            gap={2}
            paddingBottom={2}
            borderBottomWidth="1px"
            borderColor="border.subtle"
            marginBottom={2}
          >
            <Icon as={LuColumns3} boxSize={4} color="fg.muted" />
            <Text textStyle="xs" color="fg.muted" fontWeight="semibold">
              Columns
            </Text>
          </HStack>
          <VStack align="stretch" gap={1.5}>
            {["Time", "Trace", "Origin", "Duration", "Cost"].map((label, idx) => (
              <HStack
                key={label}
                paddingX={2}
                paddingY={1}
                borderRadius="sm"
                bg={idx === 1 ? "bg.panel" : undefined}
                borderWidth={idx === 1 ? "1px" : "0"}
                borderColor="blue.muted"
              >
                <Icon as={LuMoveHorizontal} boxSize={3} color="fg.subtle" />
                <Checkbox.Root size="xs" defaultChecked>
                  <Checkbox.Control />
                </Checkbox.Root>
                <Text textStyle="xs" color="fg">
                  {label}
                </Text>
              </HStack>
            ))}
          </VStack>
        </Card>

        <Checkbox.Root
          checked={dontShowAgain}
          onCheckedChange={(e) => setDontShowAgain(e.checked === true)}
          size="sm"
        >
          <Checkbox.HiddenInput />
          <Checkbox.Control>
            <Checkbox.Indicator />
          </Checkbox.Control>
          <Checkbox.Label>
            <Text textStyle="xs" color="fg.muted">
              Don't show this again
            </Text>
          </Checkbox.Label>
        </Checkbox.Root>
      </VStack>
    </Dialog>
  );
};
