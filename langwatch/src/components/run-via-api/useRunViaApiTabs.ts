/**
 * Shared state + tab assembly for the Run via API dialog.
 *
 * Owns the selected data source and turns a snippet builder into the ordered
 * language tabs the dialog renders (Python first, then TypeScript, then Shell).
 * Returns state and callbacks only, never JSX, so both the workflow and the
 * experiment buttons can reuse it.
 */
import type { PrismLanguage } from "@react-email/components";
import { useMemo, useState } from "react";

import type { ApiSnippetTab } from "../GenerateApiSnippetDialog";
import type { RunSnippetDataSource, RunSnippetLang } from "./runSnippets";

interface LangTabSpec {
  value: RunSnippetLang;
  label: string;
  language: PrismLanguage;
}

/** Tab order is fixed: Python default, then TypeScript, then Shell. */
const LANG_TABS: LangTabSpec[] = [
  { value: "python", label: "Python", language: "python" },
  { value: "typescript", label: "TypeScript", language: "typescript" },
  { value: "shell", label: "Shell", language: "bash" },
];

export function useRunViaApiTabs(
  buildSnippet: (
    lang: RunSnippetLang,
    dataSource: RunSnippetDataSource,
  ) => string,
): {
  dataSource: RunSnippetDataSource;
  setDataSource: (dataSource: RunSnippetDataSource) => void;
  tabs: ApiSnippetTab[];
} {
  const [dataSource, setDataSource] =
    useState<RunSnippetDataSource>("attached");

  const tabs = useMemo<ApiSnippetTab[]>(
    () =>
      LANG_TABS.map((tab) => ({
        value: tab.value,
        label: tab.label,
        language: tab.language,
        content: buildSnippet(tab.value, dataSource),
      })),
    [buildSnippet, dataSource],
  );

  return { dataSource, setDataSource, tabs };
}
