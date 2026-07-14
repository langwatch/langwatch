import type { NotifyPreview } from "~/automations/providers/client";
import type { ConfigFormCtx } from "~/automations/providers/types";
import { useAutomationStore } from "../../state/automationStore";
import { useActiveProvider } from "../../state/selectors";
import { SecondaryDrawerShell } from "./SecondaryDrawerShell";

/**
 * Configuration secondary drawer. Delegates the type-specific UI to the
 * active provider's `ConfigForm`. Identity fields (name + alert type)
 * live on the main drawer now, so this surface is purely about the
 * destination — recipients, templates, dataset target, etc.
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
        title="Setup"
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
  const title = `${provider.shared.label} setup`;

  return (
    <SecondaryDrawerShell
      open={open}
      title={title}
      onClose={onDone}
      onDone={onDone}
    >
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
    </SecondaryDrawerShell>
  );
}
