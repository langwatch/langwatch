import {
  ScenarioMessageRenderer as FeatureScenarioMessageRenderer,
  type ScenarioMessageRendererProps as FeatureScenarioMessageRendererProps,
  type StreamingMessage,
} from "@langwatch/simulation-web";
import type { SimulationMessage } from "@langwatch/simulation-contract";
import { Bubble } from "~/features/traces-v2/components/TraceTable/registry/addons/conversation/Bubble";
import { getDisplayRoleVisuals } from "~/features/traces-v2/components/TraceDrawer/scenarioRoles";
import { RenderInputOutput } from "../traces/RenderInputOutput";
import { RunTurnSeparator } from "./RunTurnSeparator";
import { MediaPart } from "./MediaPart";

export interface ScenarioMessageRendererProps {
  messages: SimulationMessage[];
  streamingMessages?: StreamingMessage[];
  variant: "grid" | "drawer";
  projectId: string;
}

/** App composition adapter for trace, tRPC and stored-object render ports. */
export function ScenarioMessageRenderer(props: ScenarioMessageRendererProps) {
  const renderProps: FeatureScenarioMessageRendererProps = {
    ...props,
    renderBubble: (bubbleProps) => <Bubble {...bubbleProps} />,
    renderInputOutput: (value) => <RenderInputOutput value={value} />,
    getRoleVisuals: (role) => {
      const visuals = getDisplayRoleVisuals(role, { isScenario: true });
      const RoleIcon = visuals.Icon;
      return {
        displayRole: visuals.displayRole,
        bubbleLabel: visuals.bubbleLabel,
        Icon: () => <RoleIcon />,
      };
    },
    renderTurnSeparator: (separatorProps) => <RunTurnSeparator {...separatorProps} />,
    renderMediaPart: (mediaProps) => <MediaPart {...mediaProps} />,
  };
  return <FeatureScenarioMessageRenderer {...renderProps} />;
}
