/**
 * One cell of the LangWatchQL result table.
 *
 * The classification and the words are decided in
 * `../logic/lwql-value-format`; this decides how each kind *looks* and
 * what a member can do with it. Two rules carry the weight:
 *
 *  - the six ways a value can be empty or non-finite are marked with
 *    `data-cell-kind`, so "null", "missing" and a String column literally
 *    holding the text `null` stay tellable apart by a reader and by a test;
 *  - only cells whose display is not the whole truth — a structure, or a value
 *    long enough to be clipped — grow controls. A copy button on every cell
 *    would put a hundred extra tab stops between a keyboard user and the next
 *    row for no gain, because an unclipped value is already on screen and
 *    selectable.
 *
 * @see packages/features/analytics/specs/analytics-lwql-workbench.feature
 */

import { Box, Button, HStack, Text } from "@chakra-ui/react";
import { useState } from "react";

import { Popover } from "@langwatch/design-system/popover";

import {
  type LangWatchQLCell,
  lwqlCellCopyText,
  lwqlCellText,
} from "../logic/lwql-value-format";

export interface LangWatchQLValueCellProps {
  cell: LangWatchQLCell;
  /** Named in the expanded view so the member knows which column they opened. */
  columnName: string;
}

export function LangWatchQLValueCell({ cell, columnName }: LangWatchQLValueCellProps) {
  const text = lwqlCellText(cell);

  // Every other kind is a token standing in for a value rather than being one:
  // absent, null, empty, or non-finite. Written as a narrowing check rather
  // than a set membership test so the compiler carries the distinction too.
  if (cell.kind !== "scalar" && cell.kind !== "structured") {
    return (
      <Text
        as="span"
        data-cell-kind={cell.kind}
        color="fg.muted"
        fontStyle="italic"
        fontSize="12.5px"
      >
        {text}
      </Text>
    );
  }

  const expandable = cell.kind === "structured" || cell.clipped;

  return (
    <HStack gap={1} align="baseline" minWidth={0}>
      <Text
        as="span"
        data-cell-kind={cell.kind}
        fontSize="12.5px"
        fontFamily={cell.kind === "structured" ? "mono" : void 0}
        whiteSpace="pre"
        overflow="hidden"
        textOverflow="ellipsis"
      >
        {text}
      </Text>
      {expandable && <ExpandedValue cell={cell} columnName={columnName} />}
    </HStack>
  );
}

/**
 * The whole value, on request.
 *
 * Controlled rather than left to the popover's own trigger handling so that
 * opening it is one state change a test can drive the same way a member does,
 * and so the content mounts only while it is open — a table window holds
 * dozens of these.
 */
function ExpandedValue({
  cell,
  columnName,
}: {
  cell: LangWatchQLCell;
  columnName: string;
}) {
  const [open, setOpen] = useState(false);
  /**
   * A structured cell is shown indented and copied compact, and the difference
   * is deliberate: reading JSON in a popover wants the line breaks, pasting it
   * somewhere else usually does not. `pretty` is a getter, so the indented form
   * is only built for the one cell a member opens, never for the other ten
   * thousand in the table. Every other kind shows exactly what it copies.
   */
  const full = cell.kind === "structured" ? cell.pretty : (lwqlCellCopyText(cell) ?? "");

  return (
    <Popover.Root
      open={open}
      onOpenChange={(details) => setOpen(details.open)}
      positioning={{ placement: "bottom-start" }}
      // Both default to false in Chakra v3, so without them every cell in a
      // ten-thousand-row table keeps its expanded content mounted while closed.
      lazyMount
      unmountOnExit
    >
      <Popover.Trigger asChild>
        <Button
          size="2xs"
          variant="ghost"
          aria-label={`Show the full value of ${columnName}`}
        >
          Show
        </Button>
      </Popover.Trigger>
      <Popover.Content width="480px" maxWidth="90vw">
        <Popover.Body>
          <HStack justify="space-between" align="center" marginBottom={2}>
            <Text fontSize="12.5px" fontWeight="medium">
              {columnName}
            </Text>
            <CopyValueButton cell={cell} columnName={columnName} />
          </HStack>
          {/* Bounded on purpose: a cell can hold a document larger than the
              popover, and a viewer that grows to fit it scrolls the page
              instead of itself. */}
          <Box
            as="pre"
            data-testid="lwql-value-full"
            maxHeight="320px"
            overflow="auto"
            fontSize="12px"
            fontFamily="mono"
            whiteSpace="pre-wrap"
            wordBreak="break-word"
          >
            {full}
          </Box>
        </Popover.Body>
      </Popover.Content>
    </Popover.Root>
  );
}

/**
 * Copies the underlying value, never the clipped rendering of it.
 *
 * `navigator.clipboard` is absent on an insecure origin and rejects when the
 * document is not focused, so the failure is swallowed rather than allowed to
 * reject unhandled — a cell copy is not worth an error boundary, and the value
 * stays selectable either way.
 */
function CopyValueButton({
  cell,
  columnName,
}: {
  cell: LangWatchQLCell;
  columnName: string;
}) {
  const copyText = lwqlCellCopyText(cell);
  if (copyText === null) return null;

  return (
    <Button
      size="2xs"
      variant="subtle"
      aria-label={`Copy the full value of ${columnName}`}
      onClick={() => {
        void navigator.clipboard?.writeText(copyText).catch(() => void 0);
      }}
    >
      Copy
    </Button>
  );
}
