import {
  Box,
  Button,
  Checkbox,
  HStack,
  Icon,
  Text,
  VStack,
} from "@chakra-ui/react";
import { LuColumns3, LuMoveHorizontal, LuSettings2 } from "react-icons/lu";
import type React from "react";
import { useState } from "react";
import {
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "~/components/ui/dialog";
import { useColumnEducationStore } from "../../stores/columnEducationStore";

/**
 * One-off teaching dialog that fires the first time the operator tries
 * to drag a column header in the v2 trace table. The v2 table doesn't
 * (yet) support native drag-to-reorder — historically users would
 * try it, nothing would happen, and they'd conclude "you can't change
 * the columns." This dialog catches that first attempt and points at
 * the Columns dropdown / Configure CTA where reordering actually
 * lives. A "Don't show again" checkbox + localStorage persistence
 * means the dialog only fires once per device.
 *
 * The visual hint uses CSS-illustrated chips rather than an image
 * asset so it stays sharp on every viewport and tracks the live
 * design tokens (no orphan PNG to update when the column-picker UI
 * evolves).
 */
export const ColumnEducationDialog: React.FC = () => {
  const isOpen = useColumnEducationStore((s) => s.isOpen);
  const dismiss = useColumnEducationStore((s) => s.dismiss);
  const [dontShowAgain, setDontShowAgain] = useState(true);

  return (
    <DialogRoot
      open={isOpen}
      onOpenChange={(e) => {
        if (!e.open) dismiss(dontShowAgain);
      }}
      placement="center"
      size="md"
    >
      <DialogContent errorScope="ColumnEducationDialog">
        <DialogHeader>
          <DialogTitle>Reorder columns</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <VStack align="stretch" gap={4}>
            <Text textStyle="sm" color="fg">
              The trace table columns aren't drag-reorderable yet — but
              you can still change which columns appear and in what
              order from the <b>Columns</b> dropdown in the toolbar or
              the floating <b>Configure</b> button.
            </Text>

            {/* CSS-illustrated preview of the column picker. Tracks the
                live design tokens so the hint always matches the real
                surface; no PNG to keep in sync. */}
            <Box
              borderWidth="1px"
              borderColor="border"
              borderRadius="md"
              padding={3}
              bg="bg.subtle"
            >
              <HStack
                gap={2}
                paddingBottom={2}
                borderBottomWidth="1px"
                borderColor="border.subtle"
                marginBottom={2}
              >
                <Icon as={LuColumns3} boxSize={4} color="fg.muted" />
                <Text textStyle="xs" color="fg.muted" fontWeight="600">
                  Columns
                </Text>
              </HStack>
              <VStack align="stretch" gap={1.5}>
                {["Time", "Trace", "Origin", "Duration", "Cost"].map(
                  (label, idx) => (
                    <HStack
                      key={label}
                      paddingX={2}
                      paddingY={1}
                      borderRadius="sm"
                      bg={idx === 1 ? "bg.panel" : undefined}
                      borderWidth={idx === 1 ? "1px" : "0"}
                      borderColor="blue.muted"
                    >
                      <Icon
                        as={LuMoveHorizontal}
                        boxSize={3}
                        color="fg.subtle"
                      />
                      <Checkbox.Root size="xs" defaultChecked>
                        <Checkbox.Control />
                      </Checkbox.Root>
                      <Text textStyle="xs" color="fg">
                        {label}
                      </Text>
                    </HStack>
                  ),
                )}
              </VStack>
            </Box>

            <HStack gap={2}>
              <Icon as={LuSettings2} boxSize={4} color="blue.fg" />
              <Text textStyle="xs" color="fg.muted">
                Or click the floating <b>Configure</b> button at the
                bottom of the table to manage facets and columns in one
                place.
              </Text>
            </HStack>

            <Checkbox.Root
              checked={dontShowAgain}
              onCheckedChange={(e) =>
                setDontShowAgain(e.checked === true)
              }
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
        </DialogBody>
        <DialogFooter>
          <Button
            size="sm"
            colorPalette="blue"
            onClick={() => dismiss(dontShowAgain)}
          >
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
};
