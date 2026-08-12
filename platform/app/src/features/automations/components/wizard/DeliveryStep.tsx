import { VStack } from "@chakra-ui/react";
import { useAutomationStore } from "../../state/automationStore";
import { useDraft } from "../../state/selectors";
import { CadenceSection } from "../CadenceSection";
import { DeliveryPicker } from "../DeliveryPicker";

/**
 * Step 2 of the merged wizard (ADR-093 §4): one channel, its configuration and
 * templates, and when it sends.
 *
 * When and where it sends is one decision, so the digest cadence and the settle
 * window ride with the channel the author is already configuring. A
 * graph-watching automation has neither — the server pins its cadence to
 * immediate — and its threshold window stays in the Watch step, where it
 * modulates firing rather than sending.
 *
 * The channel choice itself is ADR-037's Notification-versus-Action picker,
 * unchanged and merely relocated into this step.
 */
export function DeliveryStep({
  isEdit,
  webhookEnabled,
}: {
  isEdit: boolean;
  webhookEnabled: boolean;
}) {
  const draft = useDraft();
  const dispatch = useAutomationStore((s) => s.dispatch);

  return (
    <VStack align="stretch" gap={3}>
      <DeliveryPicker
        value={draft.action}
        onChange={(value) => dispatch({ type: "SET_ACTION", value })}
        source={draft.source}
        webhookEnabled={webhookEnabled}
        preserveHiddenWebhook={isEdit}
      />
      {draft.source === "trace" ? (
        <CadenceSection isEdit={isEdit} title="When it sends" />
      ) : null}
    </VStack>
  );
}
