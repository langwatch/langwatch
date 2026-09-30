import { VStack } from "@chakra-ui/react";

import { useDraft } from "./automation-selectors.ts";
import { useAutomationStore } from "./automation-store.ts";
import { CadenceSection } from "./cadence-section-adapter.tsx";
import { DeliveryPicker } from "./delivery-picker.tsx";

/**
 * Step 2 of the wizard (ADR-093 §4): one channel, its configuration and when it
 * sends, one decision. A graph-watching automation has no send cadence (the
 * server pins it to immediate); its threshold window stays in the Watch step.
 */
export function DeliveryStep({ isEdit }: { isEdit: boolean }) {
  const draft = useDraft();
  const dispatch = useAutomationStore((s) => s.dispatch);

  return (
    <VStack align="stretch" gap={3}>
      <DeliveryPicker
        value={draft.action}
        onChange={(value) => dispatch({ type: "SET_ACTION", value })}
        source={draft.source}
      />
      {draft.source === "trace" ? <CadenceSection isEdit={isEdit} title="When it sends" /> : null}
    </VStack>
  );
}
