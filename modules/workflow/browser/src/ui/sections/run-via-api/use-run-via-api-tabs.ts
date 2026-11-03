import { useMemo, useState } from "react";

/**
 * Shared state + tab assembly for the Run via API dialog. Turns a snippet
 * builder into ordered language tabs; returns state and callbacks only,
 * never JSX, so both the workflow and experiment buttons can reuse it.
 */
import type { PrismLanguage } from "../../../model/prism-language.ts";
import type {
  RunSnippetDataSource,
  RunSnippetLang,
} from "../../../model/run-via-api/run-snippets.ts";
import type { ApiSnippetTab } from "../generate-api-snippet-dialog.tsx";

interface LangTabSpec {
  value: RunSnippetLang;
  label: string;
  language: PrismLanguage;
}

/** Tab order is fixed: Python default, then TypeScript, Go, Shell, then the CI tabs. */
const LANG_TABS: LangTabSpec[] = [
  { value: "python", label: "Python", language: "python" },
  { value: "typescript", label: "TypeScript", language: "typescript" },
  { value: "go", label: "Go", language: "go" },
  { value: "shell", label: "Shell", language: "bash" },
  { value: "cli", label: "CLI", language: "bash" },
  { value: "github_actions", label: "GitHub Actions", language: "yaml" },
];

/** The languages every Run via API dialog offers; an experiment adds the CI tabs. */
export const API_LANGS: RunSnippetLang[] = ["python", "typescript", "go", "shell"];

export function useRunViaApiTabs(
  buildSnippet: (args: { lang: RunSnippetLang; dataSource: RunSnippetDataSource }) => string,
  langs: RunSnippetLang[] = API_LANGS,
): {
  dataSource: RunSnippetDataSource;
  setDataSource: (dataSource: RunSnippetDataSource) => void;
  tabs: ApiSnippetTab[];
} {
  const [dataSource, setDataSource] = useState<RunSnippetDataSource>("attached");

  const tabs = useMemo<ApiSnippetTab[]>(
    () =>
      LANG_TABS.filter((tab) => langs.includes(tab.value)).map((tab) => ({
        value: tab.value,
        label: tab.label,
        language: tab.language,
        content: buildSnippet({ lang: tab.value, dataSource }),
      })),
    [buildSnippet, dataSource, langs],
  );

  return { dataSource, setDataSource, tabs };
}
