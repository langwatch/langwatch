/**
 * The drawers one module opens and another owns, by name: the props each owner declared. A
 * module's own drawers stay typed from its `withDrawers` declaration instead. Like
 * `declarations.ts`, this is where a shape every browser package compiles against lives.
 */

import type { ComponentType } from "react";

import type { UiAddOrEditDatasetDrawerProps } from "../../declarations.ts";
import type {
  UiAgentEditorDrawerProps,
  UiAgentListDrawerProps,
  UiAgentTypeSelectorDrawerProps,
  UiWorkflowSelectorDrawerProps,
} from "./agent-drawers.ts";
import type { UiAutomationDrawerProps } from "./automation-drawers.ts";
import type {
  UiCodeEvaluatorEditorDrawerProps,
  UiEvaluatorCategorySelectorDrawerProps,
  UiEvaluatorEditorDrawerProps,
  UiEvaluatorListDrawerProps,
  UiOnlineEvaluationDrawerProps,
  UiWorkflowSelectorForEvaluatorDrawerProps,
} from "./evaluator-drawers.ts";
import type { UiFoundryDrawerProps } from "./ops-drawers.ts";
import type { UiInviteMemberDrawerProps } from "./organization-drawers.ts";
import type { UiPromptEditorDrawerProps, UiPromptListDrawerProps } from "./prompt-drawers.ts";
import type {
  UiAgentTestingCaseEditorDrawerProps,
  UiScenarioRunDetailDrawerProps,
} from "./scenario-drawers.ts";

/** Entries land owner by owner; until a drawer has one, its props read as an open record. */
export type UiDrawerMap = {
  addOrEditDataset: UiAddOrEditDatasetDrawerProps;
  agentCodeEditor: UiAgentEditorDrawerProps;
  agentHttpEditor: UiAgentEditorDrawerProps;
  agentList: UiAgentListDrawerProps;
  agentTestingCaseEditor: UiAgentTestingCaseEditorDrawerProps;
  agentTypeSelector: UiAgentTypeSelectorDrawerProps;
  agentWorkflowEditor: UiAgentEditorDrawerProps;
  automation: UiAutomationDrawerProps;
  codeEvaluatorEditor: UiCodeEvaluatorEditorDrawerProps;
  evaluatorCategorySelector: UiEvaluatorCategorySelectorDrawerProps;
  evaluatorEditor: UiEvaluatorEditorDrawerProps;
  evaluatorList: UiEvaluatorListDrawerProps;
  foundry: UiFoundryDrawerProps;
  inviteMember: UiInviteMemberDrawerProps;
  onlineEvaluation: UiOnlineEvaluationDrawerProps;
  promptEditor: UiPromptEditorDrawerProps;
  promptList: UiPromptListDrawerProps;
  scenarioRunDetail: UiScenarioRunDetailDrawerProps;
  workflowSelector: UiWorkflowSelectorDrawerProps;
  workflowSelectorForEvaluator: UiWorkflowSelectorForEvaluatorDrawerProps;
};

/**
 * A callback of a drawer no map declares yet. A method type, so it compares bivariantly: a
 * handler typed for its own argument still registers, while the drawer is not yet declared.
 */
type UndeclaredDrawerCallback = { bivarianceHack(...args: unknown[]): unknown }["bivarianceHack"];

/** The callbacks of a drawer no map declares yet. */
export type UndeclaredDrawerCallbacks = Record<string, UndeclaredDrawerCallback | undefined>;

/** Only the callback (function) props of a drawer's props. */
export type DrawerCallbacksIn<Props> = {
  [
    K in keyof Props as Props[K] extends ((...args: never[]) => unknown) | undefined ? K : never
  ]?: Props[K];
};

/** A drawer's props: its declared entry in `Map`, or an open record while it has none. */
export type UiDrawerPropsOf<Map, Name extends string> = Name extends keyof Map
  ? Map[Name]
  : Record<string, unknown>;

/** Every drawer's flow callbacks, by name: declared ones typed, the rest open. */
export type UiFlowCallbacksStore = {
  [Name in keyof UiDrawerMap]?: DrawerCallbacksIn<UiDrawerMap[Name]>;
} & Record<string, UndeclaredDrawerCallbacks | undefined>;

/**
 * A module's own drawers as a props map, read off what it registered: a component per name, or
 * the `{ load }` its `withDrawers` declares. `useDrawer<DrawerPropsMapOf<typeof drawers>>()`.
 */
export type DrawerPropsMapOf<Drawers> = {
  [Name in keyof Drawers]: Drawers[Name] extends ComponentType<infer Props>
    ? Props
    : Drawers[Name] extends { load: () => Promise<{ default: ComponentType<infer Props> }> }
      ? Props
      : never;
};

/**
 * Drawers whose registered props differ from their entry in `Map`: an owner's registration
 * checked against what the other modules open it with. `never` when every entry agrees.
 */
export type DrawersDifferingFromMap<Drawers, Map = UiDrawerMap> = {
  [Name in keyof Drawers & keyof Map]: [DrawerPropsMapOf<Drawers>[Name]] extends [Map[Name]]
    ? [Map[Name]] extends [DrawerPropsMapOf<Drawers>[Name]]
      ? never
      : Name
    : Name;
}[keyof Drawers & keyof Map];
