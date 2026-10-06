/** Scenario UI lent by token to the modules that test an agent (§10, §10.1). */

import { uiTokens } from "@langwatch/module";

import type { ScenarioParameterDefinition } from "./scenario.parameters.ts";

/** What agent's test panel hands scenario's parameter line: the agent's own parameters. */
export type ParameterLineFieldProps = {
  definitions: readonly ScenarioParameterDefinition[];
  value: string;
  onChange: (line: string) => void;
  ariaLabel: string;
  testId: string;
};

/** What agent's editor hands scenario's Talk-to-it call panel. */
export type TalkToItPanelProps = {
  projectId: string;
  projectSlug: string;
  transport: string;
  agentId: string;
  agentRowId?: string;
  name?: string;
  onAgentCreated?: (agentRowId: string) => void;
};

export const ParameterLineFieldToken =
  uiTokens("scenario").component<ParameterLineFieldProps>("parameterLineField");
export const TalkToItPanelToken =
  uiTokens("scenario").component<TalkToItPanelProps>("talkToItPanel");
