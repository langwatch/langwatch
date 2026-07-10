import { Box, HStack, Spacer, Text } from "@chakra-ui/react";
import { HelpCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Tooltip } from "~/components/ui/tooltip";

/**
 * The bordered panel one facet is authored in (ADR-043). Each facet reads
 * as the same shape — a semibold title, an optional `(?)` tooltip carrying
 * the long explanation (copywriting.md keeps the header short), an optional
 * trailing control, and the facet's fields below. Used by Subject, Cadence,
 * Severity, Type, and Delivery so the flow scans as one form.
 */
export function FacetSection({
  title,
  help,
  headerRight,
  children,
}: {
  title: string;
  /** Long-form explanation, shown behind a `(?)` icon next to the title. */
  help?: string;
  /** Optional control pinned to the right of the header (e.g. a Code switch). */
  headerRight?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Box padding={3} borderRadius="md" border="1px solid" borderColor="border">
      <HStack mb={3} gap={2}>
        <Text fontWeight="semibold">{title}</Text>
        {help ? (
          <Tooltip content={help}>
            <Box color="fg.muted" display="inline-flex" cursor="help">
              <HelpCircle size={13} />
            </Box>
          </Tooltip>
        ) : null}
        <Spacer />
        {headerRight}
      </HStack>
      {children}
    </Box>
  );
}
