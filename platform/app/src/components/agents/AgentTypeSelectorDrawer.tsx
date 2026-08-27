import {
  AgentTypeSelectorDrawer as AgentTypeSelector,
  type AgentTypeSelectorDrawerProps as PresentationalProps,
  type AgentType,
} from "@langwatch/agent-web";
import { getComplexProps, useDrawer } from "~/hooks/useDrawer";

export type { AgentType };

export type AgentTypeSelectorDrawerProps = Omit<PresentationalProps, "onGoBack">;

export function AgentTypeSelectorDrawer(props: AgentTypeSelectorDrawerProps) {
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

  return (
    <AgentTypeSelector
      open={props.open === true}
      onClose={onClose}
      onGoBack={goBack}
      canGoBack={canGoBack}
      onSelect={handleSelect}
    />
  );
}
