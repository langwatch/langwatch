import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { AlertTriangle, BookOpen, X } from "lucide-react";
import type React from "react";
import { Popover } from "~/components/ui/popover";
import { useUIStore } from "../../stores/uiStore";

/**
 * Severity of a query-state issue — drives the SearchBar's border tint and
 * the matching badge. The previous design rendered a tiny yellow triangle
 * for warnings and a red "Syntax" pill for errors, which were visually so
 * different the user often missed the warning entirely. One indicator
 * component, one colour palette per severity.
 */
export type SearchBarStatus =
  | { kind: "ok" }
  | { kind: "warning"; message: string }
  | { kind: "error"; message: string };

const STATUS_PALETTE: Record<
  "warning" | "error",
  { fg: string; bg: string; border: string; label: string }
> = {
  warning: {
    fg: "orange.fg",
    bg: "orange.subtle",
    border: "orange.muted",
    label: "Warning",
  },
  error: {
    fg: "red.fg",
    bg: "red.subtle",
    border: "red.muted",
    label: "Syntax",
  },
};

/** The bar's outer border colour for a given status. */
export function statusBorderColor(status: SearchBarStatus): string {
  if (status.kind === "error") return "red.fg";
  if (status.kind === "warning") return "orange.fg";
  return "border";
}

/** The bar's outer background colour for a given status. */
export function statusBackgroundColor(status: SearchBarStatus): string {
  if (status.kind === "error") return "red.subtle/30";
  if (status.kind === "warning") return "orange.subtle/30";
  return "bg.surface";
}

/**
 * Single badge shown when the bar is in a warning or error state. Replaces
 * the old `CrossFacetWarning` triangle and `ParseErrorIndicator` pill —
 * they used to live next to each other with completely different shapes
 * and weights, making it easy to miss that anything was wrong. Now both
 * paths render the same badge shape, just tinted differently.
 */
export const StatusBadge: React.FC<{
  status: SearchBarStatus;
}> = ({ status }) => {
  const setSyntaxHelpOpen = useUIStore((s) => s.setSyntaxHelpOpen);
  if (status.kind === "ok") return null;
  const palette = STATUS_PALETTE[status.kind];

  return (
    <Popover.Root positioning={{ placement: "bottom-end" }}>
      <Popover.Trigger asChild>
        <Button
          size="2xs"
          variant="surface"
          flexShrink={0}
          bg={palette.bg}
          color={palette.fg}
          borderWidth="1px"
          borderColor={palette.border}
          gap={1.5}
          paddingX={2}
          aria-label={`View ${palette.label.toLowerCase()}`}
          _hover={{ bg: palette.bg, filter: "brightness(0.96)" }}
        >
          <AlertTriangle size={12} />
          <Text textStyle="xs" fontWeight="600">
            {palette.label}
          </Text>
        </Button>
      </Popover.Trigger>
      <Popover.Content maxWidth="320px">
        <Popover.Arrow />
        <Popover.Body>
          <HStack gap={2} align="start" marginBottom={2}>
            <Box
              boxSize="20px"
              borderRadius="sm"
              bg={palette.bg}
              color={palette.fg}
              display="flex"
              alignItems="center"
              justifyContent="center"
              flexShrink={0}
            >
              <AlertTriangle size={11} />
            </Box>
            <VStack align="start" gap={0.5}>
              <Text
                textStyle="xs"
                fontWeight="700"
                color="fg"
                textTransform="uppercase"
                letterSpacing="0.08em"
              >
                {status.kind === "error" ? "Invalid query" : "Heads up"}
              </Text>
              <Text textStyle="sm" color="fg">
                {status.message}
              </Text>
            </VStack>
          </HStack>
          {status.kind === "error" && (
            <Box
              marginBottom={2}
              paddingX={2}
              paddingY={1.5}
              borderRadius="sm"
              bg="bg.subtle"
              borderLeftWidth="2px"
              borderColor="blue.muted"
            >
              <Text textStyle="xs" color="fg.muted">
                Searching for a phrase? Wrap it in quotes —{" "}
                <Text as="span" fontFamily="mono" color="fg">
                  &quot;refund policy&quot;
                </Text>
                .
              </Text>
            </Box>
          )}
          <Button
            size="xs"
            variant="surface"
            colorPalette="blue"
            width="full"
            onClick={() => setSyntaxHelpOpen(true)}
          >
            <BookOpen size={12} />
            Open syntax help
          </Button>
        </Popover.Body>
      </Popover.Content>
    </Popover.Root>
  );
};

/** Trailing "Clear" button shown when the search bar has any content. */
export const ClearButton: React.FC<{
  onClear: (event: React.MouseEvent) => void;
}> = ({ onClear }) => (
  <Button
    size="2xs"
    variant="ghost"
    flexShrink={0}
    fontWeight="normal"
    color="fg.subtle"
    paddingX={2}
    gap={1.5}
    onMouseDown={onClear}
  >
    Clear
    <X size={12} />
  </Button>
);

