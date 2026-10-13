/** Workflow UI lent by token to modules that show a version, run a workflow or clamp text. */

import { uiTokens } from "@langwatch/module";
import type { WorkflowField } from "@langwatch/workflow-contract";
import type { ReactNode } from "react";

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

/** What a screen hands workflow's clamped text that expands into a dialog. */
export type HoverableBigTextProps = {
  children: ReactNode;
  lineClamp?: number;
  expandedVersion?: string;
  expandable?: boolean;
};

/** What a screen hands workflow's marker for a trace field the reader may not see. */
export type RedactedFieldProps = {
  field: "input" | "output";
  children: ReactNode;
  loadingComponent?: ReactNode;
  redacted?: boolean;
  visibleTo?: string | null;
};

export const VersionBoxToken = uiTokens("workflow").component<VersionBoxProps>("versionBox");
export const RunExperimentViaApiDialogToken = uiTokens(
  "workflow",
).component<RunExperimentViaApiDialogProps>("runExperimentViaApiDialog");
export const HoverableBigTextToken =
  uiTokens("workflow").component<HoverableBigTextProps>("hoverableBigText");
export const RedactedFieldToken =
  uiTokens("workflow").component<RedactedFieldProps>("redactedField");
