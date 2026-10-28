import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import {
  type DeployLabelCheck,
  DeployLabelsDialog,
  type DeployLabelsState,
} from "./deploy-labels-dialog.tsx";

const VERSIONS = [
  { version: 3, commitMessage: "Point at the new endpoint" },
  { version: 2, commitMessage: "Raise the timeout" },
  { version: 1, commitMessage: null },
];

function checkLabel(label: string): DeployLabelCheck {
  if (label === "latest")
    return { valid: false, reason: '"latest" always points at the newest version.' };
  if (/^\d+$/.test(label)) return { valid: false, reason: "A label cannot be a number." };
  return { valid: true };
}

function useStoryState(initial: Record<string, number | null>): DeployLabelsState {
  const [selections, setSelections] = useState(initial);
  const [extra, setExtra] = useState<string[]>([]);
  return {
    versions: VERSIONS,
    latestVersion: 3,
    labels: [...new Set([...Object.keys(initial), ...extra])],
    selections,
    isSaving: false,
    saveError: null,
    select: (label, version) => setSelections((current) => ({ ...current, [label]: version })),
    addLabel: (label) => setExtra((current) => [...current, label]),
    resetSelections: () => setSelections(initial),
    save: () => Promise.resolve(true),
  };
}

const meta = {
  title: "Overlays/Deploy labels dialog",
  parameters: {
    usage: {
      use: "Pointing an agent's or evaluator's deploy labels, such as production, at saved versions.",
      avoid: "Picking which label a monitor or experiment runs: use the deploy label select.",
    },
  },
  component: DeployLabelsDialog,
  tags: ["autodocs"],
  args: {
    open: true,
    onClose: () => undefined,
    entityName: "Support bot",
    entityNoun: "agent",
    state: {
      versions: VERSIONS,
      latestVersion: 3,
      labels: ["production", "staging"],
      selections: { production: 2, staging: null },
      isSaving: false,
      saveError: null,
      select: () => undefined,
      addLabel: () => undefined,
      resetSelections: () => undefined,
      save: () => Promise.resolve(true),
    },
    checkLabel,
    testIdPrefix: "story-deploy",
  },
} satisfies Meta<typeof DeployLabelsDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => {
    const state = useStoryState({ production: 2, staging: null });
    return <DeployLabelsDialog {...args} state={state} />;
  },
};

export const SaveRefused: Story = {
  args: {
    state: {
      ...meta.args.state,
      saveError: "That agent version doesn't exist. The label may have been removed.",
    },
  },
};
