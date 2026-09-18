/**
 * One cell of the LangWatchQL result table: classification/words come from `lwql-value-format`,
 * this decides how each kind looks. `data-cell-kind` keeps "null" and literal "null" tellable
 * apart; only cells whose display isn't the whole truth grow controls, sparing a keyboard tab stop.
 */

import { Box, Button, HStack, Text } from "@chakra-ui/react";
import { Popover } from "@langwatch/design-system/popover";
import { useState } from "react";

import {
  type LangWatchQLCell,
  lwqlCellCopyText,
  lwqlCellText,
} from "../../model/lwql-value-format.ts";

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
 * The whole value, on request. Controlled rather than left to the popover's own trigger
 * handling, so opening it is one state change a test can drive like a member, and the content
 * mounts only while open -- a table window holds dozens of these.
 */
function ExpandedValue({ cell, columnName }: { cell: LangWatchQLCell; columnName: string }) {
  const [open, setOpen] = useState(false);
  /**
   * A structured cell shows indented, copies compact -- reading JSON wants line breaks,
   * pasting usually doesn't. `pretty` is a getter, built only for the one cell a member opens,
   * never the other ten thousand in the table. Every other kind shows exactly what it copies.
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
        <Button size="2xs" variant="ghost" aria-label={`Show the full value of ${columnName}`}>
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
 * Copies the underlying value, never its clipped rendering. `navigator.clipboard` is absent
 * on an insecure origin and rejects when unfocused, so the failure is swallowed rather than
 * left unhandled -- not worth an error boundary, and the value stays selectable either way.
 */
function CopyValueButton({ cell, columnName }: { cell: LangWatchQLCell; columnName: string }) {
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
