/**
 * The agent drawers, mounted in the host their package asks for. The three
 * editors it opens are registered by `simulations-drawers`, not here — this
 * family only writes their address.
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
