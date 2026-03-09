import { Box, type BoxProps, HStack, Text, VStack } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import { isJson } from "../utils/isJson";
import { Markdown } from "./Markdown";
import { RenderInputOutput } from "./traces/RenderInputOutput";
import { Dialog } from "./ui/dialog";
import { Switch } from "./ui/switch";
import { Tooltip } from "./ui/tooltip";

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
    <Dialog.Root
      open={open}
      onOpenChange={({ open }) => onOpenChange(open)}
      size="5xl"
    >
      <Dialog.Content>
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
              onChange={() => setIsFormatted(!isFormatted)}
            />
            <Text>Formatted</Text>
          </HStack>
        </Dialog.Header>
        <Dialog.CloseTrigger />
        <Dialog.Body paddingY={6} paddingX={8} overflow="auto" maxHeight="calc(100vh - 200px)">
          {open && textExpanded && isFormatted ? (
            isJson(textExpanded) ? (
              <RenderInputOutput value={textExpanded} showTools={"copy-only"} />
            ) : (
              <Markdown className="markdown">
                {typeof textExpanded === "string"
                  ? textExpanded
                      .replace(/\n(?![\n\-])/g, "\n")
                      .replace(/(\n+)\\(\n+)/g, "$1$2")
                  : JSON.stringify(textExpanded, null, 2)}
              </Markdown>
            )
          ) : textExpanded ? (
            <Box whiteSpace="pre-wrap" fontFamily="mono">
              {textExpanded}
            </Box>
          ) : null}
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}

export function HoverableBigText({
  children,
  expandedVersion,
  expandable = true,
  ...props
}: BoxProps & { expandedVersion?: string; expandable?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [isOverflown, setIsOverflown] = useState(false);
  const [textExpanded, setTextExpanded] = useState<string | undefined>(
    undefined,
  );
  const expandedVersion_ = expandedVersion ?? children;

  const checkOverflow = () => {
    setIsOverflown(
      ref.current
        ? Math.abs(ref.current.offsetWidth - ref.current.scrollWidth) > 2 ||
            Math.abs(ref.current.offsetHeight - ref.current.scrollHeight) > 2
        : false,
    );
  };

  // Check on every rerender
  setTimeout(checkOverflow, 100);

  return (
    <>
      <Tooltip
        disabled={!isOverflown}
        content={
          <VStack padding={0} gap={0} width="full" display="block">
            {expandable && (
              <Text
                textAlign="center"
                background="black"
                width="calc(100% + 16px)"
                marginLeft="-8px"
                marginTop="-4px"
                color="yellow.400"
              >
                click anywhere to expand
              </Text>
            )}
            <Box whiteSpace="pre-wrap">
              <center></center>
              {typeof expandedVersion_ === "string"
                ? expandedVersion_.slice(0, 2000) +
                  (expandedVersion_.length > 2000 ? "..." : "")
                : expandedVersion_}
            </Box>
          </VStack>
        }
      >
        <Box
          ref={ref}
          width="full"
          height="full"
          whiteSpace="normal"
          lineClamp={7}
          {...props}
          {...(isOverflown &&
            expandable && {
              onClick: (e) => {
                e.stopPropagation();
                setTextExpanded(expandedVersion_ as string);
              },
            })}
        >
          {children}
        </Box>
      </Tooltip>
      <ExpandedTextDialog
        open={!!textExpanded}
        onOpenChange={(open) =>
          setTextExpanded(open ? (expandedVersion_ as string) : undefined)
        }
        textExpanded={textExpanded}
      />
    </>
  );
}
