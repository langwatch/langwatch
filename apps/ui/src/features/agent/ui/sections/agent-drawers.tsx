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
 * THE THREE EDITORS IT LEADS TO ARE REGISTERED, AND NOT HERE. `agentCodeEditor`,
 * `agentHttpEditor` and `workflowSelector` are `@langwatch/scenario-web`
 * components that read that package's host, so they are mounted by the
 * simulations feature — `features/simulations/ui/sections/simulations-drawers`
 * states the rule and the reasoning. This family writes the address and owns
 * nothing else about them; the caller's own `onSelect` still fires alongside,
 * which is what the flows that pass one act on.
 *
 * "Connect from Code" is the same shape: the card is the package's, the address
 * it opens (`agentConnectFromCode`) is this application's, so it arrives as a
 * callback rather than as a name the package would have to know.
 */

import {
  AgentTypeSelectorDrawer as AgentTypeSelector,
  type AgentType,
  type AgentTypeSelectorDrawerProps as PresentationalProps,
} from "@langwatch/agent-web/screens/agent-management";
import { getComplexProps, useDrawer } from "@langwatch/ui-drawer";

import { withHost } from "../../../../ui/sections/ui-page";
import { AgentHost } from "./agent-host";

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
      onConnectFromCode={() => openDrawer("agentConnectFromCode")}
    />
  );
}

export const AgentTypeSelectorDrawer = withHost(AgentHost, AgentTypeSelectorFromAddress);
