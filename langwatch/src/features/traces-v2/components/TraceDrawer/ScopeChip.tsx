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
 * Compact chip surfacing the OTel instrumentation scope (e.g. the SDK
 * library that produced the span). The scope answers "where did this come
 * from" — invaluable when triaging instrumentation bugs.
 */
export function ScopeChip({ scope, prominent = false }: ScopeChipProps) {
  if (!scope || !scope.name) return null;

  const label = scope.version ? `${scope.name} ${scope.version}` : scope.name;

  return (
    <Tooltip
      content={
        <VStack align="stretch" gap={0.5} minWidth="180px">
          <TooltipRow label="Scope" value={scope.name} />
          {scope.version && <TooltipRow label="Version" value={scope.version} />}
        </VStack>
      }
      positioning={{ placement: "top" }}
    >
      <HStack
        gap={1.5}
        paddingX={prominent ? 2 : 1.5}
        paddingY={prominent ? 0.5 : 0}
        borderRadius="sm"
        bg="bg.muted"
        flexShrink={0}
      >
        <Icon as={LuPackage} boxSize={3} color="fg.subtle" />
        <Text
          textStyle="2xs"
          color="fg.muted"
          fontFamily="mono"
          truncate
          maxWidth="220px"
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
