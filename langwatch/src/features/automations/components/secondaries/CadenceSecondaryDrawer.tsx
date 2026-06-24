import { Text, VStack } from "@chakra-ui/react";
import { CadenceField } from "../CadenceField";
import { TraceDebounceField } from "../TraceDebounceField";
import { SecondaryDrawerShell } from "./SecondaryDrawerShell";

/**
 * Cadence secondary drawer. Hosts the per-trigger digest cadence (ADR-026)
 * and the trace-readiness settle window (ADR-030) — both notify-only
 * knobs that previously sat inline on the main pane. The fields dispatch
 * straight to the store (same live-edit pattern as the configuration
 * secondary), so "Done" only closes the drawer.
 */
export function CadenceSecondaryDrawer({
  open,
  onDone,
}: {
  open: boolean;
  onDone: () => void;
}) {
  return (
    <SecondaryDrawerShell
      open={open}
      title="Cadence"
      onClose={onDone}
      onDone={onDone}
      size="md"
    >
      <VStack align="stretch" gap={5}>
        <Text textStyle="sm" color="fg.muted">
          Immediate sends one notification per matching trace. Any other cadence
          collects every match in the window and sends them together as a single
          digest message.
        </Text>
        <CadenceField />
        <TraceDebounceField />
      </VStack>
    </SecondaryDrawerShell>
  );
}
