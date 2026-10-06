/** Workflow UI lent by token to the modules that show a version or run a workflow (§10, §10.1). */

import { uiTokens } from "@langwatch/module";

import type { WorkflowField } from "./workflow.ts";

/** What a screen hands workflow's version badge; no version draws an empty badge. */
export type VersionBoxProps = {
  version?: { autoSaved?: boolean; version: string };
  minWidth?: string;
  backgroundColor?: string;
};

/** What the experiment workbench hands workflow's "Run via API" dialog. */
export type RunExperimentViaApiDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  experimentSlug: string;
  entryFields: WorkflowField[];
  datasetColumns: string[];
  datasetName?: string;
  projectSlug?: string;
};

export const VersionBoxToken = uiTokens("workflow").component<VersionBoxProps>("versionBox");
export const RunExperimentViaApiDialogToken = uiTokens(
  "workflow",
).component<RunExperimentViaApiDialogProps>("runExperimentViaApiDialog");
