import { Markdown } from "@langwatch/browser-host/markdown";
/**
 * A long cell value in full, formatted as JSON or markdown or left raw. Copied
 * from workflow's thin, non-fetching dialog (ARCHITECTURE.md §3.4, rule 5).
 */
import { Box, HStack, Text } from "@langwatch/design-system/primitives";
import { Dialog } from "@langwatch/design-system/studio-dialog";
import { Switch } from "@langwatch/design-system/switch";
import { useState } from "react";

import { RenderInputOutput } from "../../behavior/lent-trace.tsx";
import { isJson } from "../../model/is-json.ts";

/** The expanded text: rendered JSON, rendered markdown, or the raw string. */
function ExpandedTextBody({
  isFormatted,
  open,
  textExpanded,
}: {
  isFormatted: boolean;
  open: boolean;
  textExpanded: string | undefined;
}) {
  if (open && textExpanded && isFormatted) {
    if (isJson(textExpanded)) {
      return <RenderInputOutput value={textExpanded} showTools={"copy-only"} />;
    }

    return (
      <Markdown>
        {typeof textExpanded === "string"
          ? textExpanded.replace(/(\n+)\\(\n+)/g, "$1$2")
          : JSON.stringify(textExpanded, null, 2)}
      </Markdown>
    );
  }

  if (textExpanded) {
    return (
      <Box whiteSpace="pre-wrap" fontFamily="mono">
        {textExpanded}
      </Box>
    );
  }

  return null;
}

export function ExpandedTextDialog({
  open,
  onOpenChange,
  textExpanded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  textExpanded: string | undefined;
}) {
  const [isFormatted, setIsFormatted] = useState(true);

  return (
    <Dialog.Root open={open} onOpenChange={({ open }) => onOpenChange(open)} size="5xl">
      <Dialog.Content bg="bg">
        <Dialog.Header
          background="bg.muted"
          padding={3}
          borderRadius="12px 12px 0 0"
          fontSize="14px"
        >
          <HStack>
            <Switch
              size="sm"
              checked={isFormatted}
              onCheckedChange={() => setIsFormatted(!isFormatted)}
            />
            <Text>Formatted</Text>
          </HStack>
        </Dialog.Header>
        <Dialog.CloseTrigger />
        <Dialog.Body paddingY={6} paddingX={8} overflow="auto" maxHeight="calc(100vh - 200px)">
          <ExpandedTextBody isFormatted={isFormatted} open={open} textExpanded={textExpanded} />
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}
