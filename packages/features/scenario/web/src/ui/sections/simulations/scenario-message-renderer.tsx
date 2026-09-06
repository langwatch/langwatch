import { type StreamingMessage } from "../../../model/scenario-message-display.ts";
import {
  ScenarioMessageRenderer as FeatureScenarioMessageRenderer,
  type ScenarioMessageRendererProps as FeatureScenarioMessageRendererProps,
} from "../scenario-message-renderer.tsx";
import type { SimulationMessage } from "@langwatch/scenario-contract";
import type { NextSpeaker } from "../../elements/next-speaker.ts";
import { Bubble } from "@langwatch/trace-web/surfaces/conversation-bubble";
import { getDisplayRoleVisuals } from "@langwatch/trace-web/surfaces/scenario-role";
import { RenderInputOutput } from "@langwatch/trace-web/surfaces/render-input-output";
import { RunTurnSeparator } from "./run-turn-separator.tsx";
import { MediaPart } from "../media-part.tsx";

export interface ScenarioMessageRendererProps {
  messages: SimulationMessage[];
  streamingMessages?: StreamingMessage[];
  variant: "grid" | "drawer";
  projectId: string;
  /** Whose message the run is waiting for, drawn as dots under the thread. */
  typingRole?: NextSpeaker;
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
