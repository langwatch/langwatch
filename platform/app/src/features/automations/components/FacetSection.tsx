import { Box, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import { Check, ChevronDown, HelpCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Tooltip } from "~/components/ui/tooltip";

/** Single-open accordion wiring, passed down from the main list. When present,
 *  the facet collapses to its header + a one-line summary and the header
 *  toggles it. Absent (the standalone / test path) renders an always-open
 *  panel. */
export interface FacetAccordionProps {
  open: boolean;
  onToggle: () => void;
}

/**
 * The bordered panel one facet is authored in (ADR-043). Each facet reads
 * as the same shape — a semibold title, an optional `(?)` tooltip carrying
 * the long explanation (copywriting.md keeps the header short), an optional
 * trailing control, and the facet's fields below.
 *
 * Given an `accordion`, the panel becomes a single-open accordion item: the
 * header is the whole click target, a completed facet shows a green check, and
 * a collapsed one previews its `summary`. Opening one collapses the rest (the
 * main list holds the single-open state). Without it, the panel stays open —
 * the shape the facet component tests render against.
 */
export function FacetSection({
  title,
  help,
  headerRight,
  children,
  accordion,
  summary,
  complete = false,
}: {
  title: string;
  /** Long-form explanation, shown behind a `(?)` icon next to the title. */
  help?: string;
  /** Optional control pinned to the right of the header (e.g. a Code switch). */
  headerRight?: ReactNode;
  children: ReactNode;
  /** Turns the panel into a collapsible accordion item. */
  accordion?: FacetAccordionProps;
  /** One-line preview shown when collapsed. */
  summary?: string;
  /** Drives the completion check + border accent. */
  complete?: boolean;
}) {
  const titleRow = (
    <HStack gap={2}>
      <Text fontWeight="semibold">{title}</Text>
      {help ? (
        <Tooltip content={help}>
          <Box color="fg.muted" display="inline-flex" cursor="help">
            <HelpCircle size={13} />
          </Box>
        </Tooltip>
      ) : null}
      {complete ? (
        <Box as="span" color="green.solid" display="inline-flex">
          <Check size={14} />
        </Box>
      ) : null}
    </HStack>
  );

  // Always-open panel (standalone / test path).
  if (!accordion) {
    return (
      <Box padding={3} borderRadius="md" border="1px solid" borderColor="border">
        <HStack mb={3} gap={2}>
          {titleRow}
          <Spacer />
          {headerRight}
        </HStack>
        {children}
      </Box>
    );
  }

  const { open, onToggle } = accordion;

  return (
    <Box
      borderRadius="md"
      border="1px solid"
      colorPalette="green"
      borderColor={complete ? "colorPalette.solid" : "border"}
      bg="bg"
    >
      <Box
        role="button"
        tabIndex={0}
        aria-expanded={open}
        width="full"
        textAlign="left"
        padding={3}
        cursor="pointer"
        borderRadius="md"
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        _hover={{
          borderColor: complete ? "colorPalette.emphasized" : "orange.400",
        }}
      >
        <HStack gap={2} align="center">
          <VStack align="start" gap={0} flex="1" minWidth="0">
            {titleRow}
            {!open && summary ? (
              <Text textStyle="sm" color="fg.muted" lineClamp={1}>
                {summary}
              </Text>
            ) : null}
          </VStack>
          {open && headerRight ? (
            // The header is the toggle; a control living in it must not also
            // collapse the panel.
            <Box onClick={(e) => e.stopPropagation()}>{headerRight}</Box>
          ) : null}
          <Box
            color="fg.muted"
            flexShrink={0}
            display="inline-flex"
            transform={open ? "rotate(180deg)" : "rotate(0deg)"}
            transition="transform 0.15s ease"
          >
            <ChevronDown size={16} />
          </Box>
        </HStack>
      </Box>
      {open ? (
        <Box paddingX={3} paddingBottom={3}>
          {children}
        </Box>
      ) : null}
    </Box>
  );
}
