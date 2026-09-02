/**
 * The agent drawers, mounted in the host their package asks for.
 *
 * `agentTypeSelector` was ALREADY a pure URL adapter in `platform/app` — the
 * control itself is `@langwatch/agent-web`'s — so what moved here is the half
 * that was always composition: reading the caller's `onSelect` off the drawer
 * navigator's in-memory slot, and turning the pick into the next drawer's
 * address.
 *
 * ONE DEFECT FIXED ON THE WAY, because carrying it would have made the move
 * pointless: `platform/app`'s adapter passed `open={props.open === true}`, and
 * the registry hands a drawer the PARSED ADDRESS — so `open` arrives as the
 * string `"agentTypeSelector"`, the strict comparison is false, and the control
 * renders closed. It reads the way every other registered drawer reads it now:
 * anything defined and not `false` means open.
 *
 * THE THREE EDITORS IT LEADS TO ARE NOT INSTALLED YET. `agentCodeEditor`,
 * `agentHttpEditor` and `workflowSelector` are still `platform/app` modules
 * behind a code editor, an outputs section and a scenario mapping section, and
 * none of those has a package home. So a pick writes the next address and
 * nothing opens — the same recorded gap this whole move is closing, one drawer
 * further in. The caller's own `onSelect` still fires, which is what the flows
 * that pass one actually act on.
 */

import {
  AgentTypeSelectorDrawer as AgentTypeSelector,
  type AgentType,
  type AgentTypeSelectorDrawerProps as PresentationalProps,
} from "@langwatch/agent-web/screens/agent-management";
import { getComplexProps, useDrawer } from "@langwatch/ui-drawer";

import { withAgentHost } from "./agent-host-provider";

export type AgentTypeSelectorProps = Omit<PresentationalProps, "onGoBack">;

function AgentTypeSelectorFromAddress(props: AgentTypeSelectorProps) {
  const { closeDrawer, openDrawer, canGoBack, goBack } = useDrawer();
  const complexProps = getComplexProps();
  const onSelectFromComplexProps =
    typeof complexProps.onSelect === "function" ? complexProps.onSelect : void 0;
  const onClose = props.onClose ?? closeDrawer;
  const onSelect = props.onSelect ?? onSelectFromComplexProps;

  const handleSelect = (type: AgentType) => {
    onSelect?.(type);

    switch (type) {
      case "code":
        openDrawer("agentCodeEditor");
        break;
      case "workflow":
        openDrawer("workflowSelector");
        break;
      case "http":
        openDrawer("agentHttpEditor");
        break;
    }
  };

  // `props.open` arrives from the address as the drawer NAME, not a boolean.
  const isOpen = props.open !== false && props.open !== undefined;

  return (
    <AgentTypeSelector
      open={isOpen}
      onClose={onClose}
      onGoBack={goBack}
      canGoBack={canGoBack}
      onSelect={handleSelect}
    />
  );
}

export const AgentTypeSelectorDrawer = withAgentHost(AgentTypeSelectorFromAddress);
