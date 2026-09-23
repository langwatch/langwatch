import type { RunSnippetDataSource, RunSnippetLang } from "@langwatch/workflow-browser-kit";
import { useMemo, useState } from "react";

/**
 * Shared state + tab assembly for the Run via API dialog. Turns a snippet
 * builder into ordered language tabs; returns state and callbacks only,
 * never JSX, so both the workflow and experiment buttons can reuse it.
 */
import type { PrismLanguage } from "../../../model/prism-language.ts";
import type { ApiSnippetTab } from "../generate-api-snippet-dialog.tsx";

interface LangTabSpec {
  value: RunSnippetLang;
  label: string;
  language: PrismLanguage;
}

/** Tab order is fixed: Python default, then TypeScript, then Go, then Shell. */
const LANG_TABS: LangTabSpec[] = [
  { value: "python", label: "Python", language: "python" },
  { value: "typescript", label: "TypeScript", language: "typescript" },
  { value: "go", label: "Go", language: "go" },
  { value: "shell", label: "Shell", language: "bash" },
];

export function useRunViaApiTabs(
  buildSnippet: (args: { lang: RunSnippetLang; dataSource: RunSnippetDataSource }) => string,
): {
  dataSource: RunSnippetDataSource;
  setDataSource: (dataSource: RunSnippetDataSource) => void;
  tabs: ApiSnippetTab[];
} {
  const [dataSource, setDataSource] = useState<RunSnippetDataSource>("attached");

  const tabs = useMemo<ApiSnippetTab[]>(
    () =>
      LANG_TABS.map((tab) => ({
        value: tab.value,
        label: tab.label,
        language: tab.language,
        content: buildSnippet({ lang: tab.value, dataSource }),
      })),
    [buildSnippet, dataSource],
  );

  return { dataSource, setDataSource, tabs };
}
