import { Box, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { LuPackage } from "react-icons/lu";
import { Tooltip } from "~/components/ui/tooltip";
import type { InstrumentationScope } from "~/server/api/routers/tracesV2.schemas";

interface ScopeChipProps {
  scope: InstrumentationScope | null;
  /** When true, render with a slightly larger affordance (used in the trace header row). */
  prominent?: boolean;
}

/**
 * Quiet inline indicator for the OTel instrumentation scope (the library
 * that produced the spans). Renders as a single subtle mono line — no
 * badge chrome — so it reads like a footer attribution rather than a
 * loud chip.
 */
export function ScopeChip({ scope }: ScopeChipProps) {
  if (!scope || !scope.name) return null;
  const label = scope.version ? `${scope.name} v${scope.version}` : scope.name;
  return (
    <Tooltip
      content={
        <VStack align="stretch" gap={1.5} minWidth="220px" maxWidth="320px">
          <Text textStyle="xs" fontWeight="semibold">
            Instrumentation scope
          </Text>
          <Text textStyle="2xs" color="fg.muted" lineHeight="1.4">
            The OpenTelemetry library that produced these spans — useful to
            tell apart spans coming from different SDKs or auto-instrumentations
            within the same trace.
          </Text>
          <VStack align="stretch" gap={0.5} paddingTop={1}>
            <TooltipRow label="Library" value={scope.name} />
            {scope.version && (
              <TooltipRow label="Version" value={scope.version} />
            )}
          </VStack>
        </VStack>
      }
      positioning={{ placement: "top" }}
    >
      <HStack gap={1} flexShrink={0} cursor="help">
        <Icon as={LuPackage} boxSize={3} color="fg.subtle" />
        <Text
          textStyle="2xs"
          color="fg.subtle"
          fontFamily="mono"
          truncate
          maxWidth="320px"
        >
          {label}
        </Text>
      </HStack>
    </Tooltip>
  );
}

function TooltipRow({ label, value }: { label: string; value: string }) {
  return (
    <HStack justify="space-between" gap={4}>
      <Text textStyle="xs" color="fg.muted">
        {label}
      </Text>
      <Text textStyle="xs" fontFamily="mono" color="fg">
        {value}
      </Text>
    </HStack>
  );
}

/** Standalone scope display used in expandable sections. */
export function ScopeBlock({ scope }: { scope: InstrumentationScope | null }) {
  if (!scope || !scope.name) {
    return (
      <Text textStyle="xs" color="fg.subtle">
        No instrumentation scope reported.
      </Text>
    );
  }
  return (
    <Box
      borderRadius="md"
      borderWidth="1px"
      borderColor="border.muted"
      bg="bg.panel"
      paddingX={3}
      paddingY={2}
    >
      <HStack gap={2}>
        <Icon as={LuPackage} boxSize={3.5} color="fg.muted" />
        <VStack align="stretch" gap={0} flex={1} minWidth={0}>
          <Text textStyle="xs" fontFamily="mono" color="fg" truncate>
            {scope.name}
          </Text>
          {scope.version && (
            <Text textStyle="2xs" fontFamily="mono" color="fg.subtle">
              v{scope.version}
            </Text>
          )}
        </VStack>
      </HStack>
    </Box>
  );
}
