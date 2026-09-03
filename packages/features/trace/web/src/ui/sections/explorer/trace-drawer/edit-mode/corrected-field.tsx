import { Box, Button, chakra, HoverCard, HStack, Portal, Text } from "@chakra-ui/react";
import { type ReactNode, useState } from "react";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { useTraceEditStore } from "../../../../../index";

/**
 * How much of a captured value the hover shows. Past this the reader is not
 * reading a value any more, they are scrolling one, and the full difference is
 * the surface built for that.
 */
export const ORIGINAL_PREVIEW_MAX_CHARS = 2000;

/** Placeholder for a field the trace never carried, so the hover still says
 *  what the correction changed rather than showing an empty box. */
const NOTHING_CAPTURED = "(nothing captured)";

/** The captured value as the hover shows it, shortened when it is very long. */
export function previewOriginal(original: string | null | undefined): {
  text: string;
  truncated: boolean;
} {
  if (original === null || original === undefined || original === "") {
    return { text: NOTHING_CAPTURED, truncated: false };
  }
  if (original.length <= ORIGINAL_PREVIEW_MAX_CHARS) {
    return { text: original, truncated: false };
  }
  return {
    text: `${original.slice(0, ORIGINAL_PREVIEW_MAX_CHARS)}…`,
    truncated: true,
  };
}

/** The green marker every corrected thing carries, in one place. */
function EditedPill() {
  return (
    <Text
      as="span"
      textStyle="2xs"
      fontWeight="semibold"
      color="green.fg"
      bg="green.subtle"
      borderWidth="1px"
      borderColor="green.muted"
      borderRadius="sm"
      paddingX={1.5}
      lineHeight={1.5}
    >
      Edited
    </Text>
  );
}

/**
 * The "Edited" marker on a corrected field, with the captured value one hover
 * away. Focusable, and opening on focus as well as on hover, so the captured
 * value is reachable without a pointer.
 */
function OriginalHoverBadge({
  label,
  original,
}: {
  label: string;
  original: string | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  const setDiffOpen = useTraceEditStore((s) => s.setDiffOpen);
  const preview = previewOriginal(original);

  return (
    <HoverCard.Root
      open={open}
      onOpenChange={(e) => setOpen(e.open)}
      openDelay={250}
      closeDelay={150}
      positioning={{ placement: "bottom-start" }}
    >
      <HoverCard.Trigger asChild>
        <chakra.button
          type="button"
          aria-label={`Show original ${label.toLowerCase()}`}
          cursor="help"
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
        >
          <EditedPill />
        </chakra.button>
      </HoverCard.Trigger>
      <Portal>
        <HoverCard.Positioner>
          <HoverCard.Content
            width="420px"
            maxWidth="90vw"
            padding={3}
            borderRadius="md"
            background="bg.panel"
            boxShadow="lg"
          >
            <Text
              textStyle="2xs"
              fontWeight="bold"
              color="fg.muted"
              textTransform="uppercase"
              letterSpacing="0.08em"
              marginBottom={1}
            >
              {`Original ${label.toLowerCase()}`}
            </Text>
            <Box
              as="pre"
              margin={0}
              maxHeight="240px"
              overflow="auto"
              fontFamily="mono"
              textStyle="2xs"
              whiteSpace="pre-wrap"
              wordBreak="break-word"
              color="fg"
            >
              {preview.text}
            </Box>
            <Button
              size="xs"
              variant="ghost"
              marginTop={2}
              onClick={() => {
                setOpen(false);
                setDiffOpen(true);
              }}
            >
              <Text textStyle="2xs">Open the full diff</Text>
            </Button>
          </HoverCard.Content>
        </HoverCard.Positioner>
      </Portal>
    </HoverCard.Root>
  );
}

/**
 * Wraps a corrected input or output: a green frame, an "Edited" marker, and the
 * captured value on hover. Long values are what this treatment is for; a scalar
 * uses {@link CorrectedScalar}, whose whole value fits in a tooltip.
 */
export function CorrectedFieldFrame({
  label,
  original,
  children,
}: {
  label: string;
  original: string | null | undefined;
  children: ReactNode;
}) {
  return (
    <Box
      borderWidth="1px"
      borderColor="green.muted"
      borderRadius="md"
      bg="green.subtle"
      padding={2}
      data-corrected-field={label.toLowerCase()}
    >
      <HStack gap={2} marginBottom={1}>
        <OriginalHoverBadge label={label} original={original} />
      </HStack>
      {children}
    </Box>
  );
}

/**
 * A corrected scalar (a span's name or type, one attribute value): the
 * corrected value with the captured one in a tooltip, because the whole value
 * fits in one line and a hover card would be a lot of chrome for a word.
 */
export function CorrectedScalar({
  label,
  original,
  children,
}: {
  label: string;
  original: string;
  children: ReactNode;
}) {
  return (
    <Tooltip content={`Original: ${original}`} positioning={{ placement: "top" }}>
      <HStack gap={1.5} aria-label={`${label}, edited. Original: ${original}`} cursor="help">
        {children}
        <EditedPill />
      </HStack>
    </Tooltip>
  );
}
