import { VStack } from "@chakra-ui/react";
import type { NotifyPreview } from "~/automations/providers/client";
import type { ConfigFormCtx } from "~/automations/providers/types";
import { useAutomationStore } from "../../state/automationStore";
import { useActiveProvider } from "../../state/selectors";
import { IdentityFields } from "../IdentityFields";
import { SecondaryDrawerShell } from "./SecondaryDrawerShell";

/**
 * Configuration secondary drawer. Identity fields first, then delegates
 * the type-specific UI to the active provider's `ConfigForm` — no
 * `if (action === SEND_EMAIL)` chain.
 */
export function ConfigurationSecondaryDrawer({
  open,
  ctx,
  onDone,
}: {
  open: boolean;
  ctx: ConfigFormCtx<NotifyPreview>;
  onDone: () => void;
}) {
  const active = useActiveProvider();
  const dispatch = useAutomationStore((s) => s.dispatch);

  if (!active) {
    return (
      <SecondaryDrawerShell
        open={open}
        title="Configuration"
        onClose={onDone}
        onDone={onDone}
      >
        Choose a type first.
      </SecondaryDrawerShell>
    );
  }

  const { provider, slice } = active;
  const Form = provider.client.ConfigForm;
  const action = provider.shared.action;

  return (
    <SecondaryDrawerShell
      open={open}
      title="Configuration"
      onClose={onDone}
      onDone={onDone}
    >
      <VStack align="stretch" gap={4}>
        <IdentityFields />
        <Form
          slice={slice}
          // The store guarantees the slice type matches `action`; the
          // ConfigForm's generic parameter is the same type the slice has
          // here, so the dispatched slice is safe.
          onChange={(next: unknown) =>
            dispatch({ type: "SET_SLICE", action, slice: next as never })
          }
          ctx={ctx}
        />
      </VStack>
    </SecondaryDrawerShell>
  );
}
