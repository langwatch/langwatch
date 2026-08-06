/**
 * The SQL editor, with assistance drawn from the live schema response.
 *
 * Every suggestion and every hover comes from `../logic/governedSchemaModel`,
 * which is a projection of what the schema endpoint returned for this member.
 * Nothing about ClickHouse beyond that is offered: no database list, no system
 * tables, no dataset the response did not carry.
 *
 * The editor never rewrites what is typed. It marks the positions a refusal
 * named and otherwise leaves the buffer alone, because the statement that runs
 * has to be the statement that was written.
 *
 * @see specs/analytics/governed-sql-workbench.feature
 */

import { Box } from "@chakra-ui/react";
import type { editor } from "monaco-editor";

import { useColorMode } from "~/components/ui/color-mode";
import dynamic from "~/utils/compat/next-dynamic";

import {
  GOVERNED_SQL_LANGUAGE,
  useGovernedSqlMonaco,
} from "../hooks/useGovernedSqlMonaco";
import type { GovernedSchemaModel } from "../logic/governedSchemaModel";
import type { GovernedSqlEditorMarker } from "../logic/governedSqlFailure";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <Box padding={4} color="fg.muted">
      Loading the editor
    </Box>
  ),
});

const EDITOR_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  minimap: { enabled: false },
  fontSize: 13,
  wordWrap: "on",
  automaticLayout: true,
  scrollBeyondLastLine: false,
  // Only Tab/Enter accept a highlighted suggestion, so ordinary punctuation
  // never swallows a keystroke while the widget is open.
  acceptSuggestionOnCommitCharacter: false,
};

export interface GovernedSqlEditorProps {
  sql: string;
  onChange: (sql: string) => void;
  /** The live schema, which is the whole of the editor's knowledge. */
  schema: GovernedSchemaModel;
  /** Positions the backend refused, if it gave any. */
  markers: readonly GovernedSqlEditorMarker[];
  /**
   * Receives a writer that inserts text at the cursor once the editor is
   * mounted, and `null` when it unmounts. The schema browser inserts through
   * it; before it arrives the workbench appends instead.
   */
  registerInsert?: (insert: ((text: string) => void) | null) => void;
  /** Runs the draft. Bound to Cmd/Ctrl+Enter inside the editor. */
  onRun?: () => void;
}

export function GovernedSqlEditor({
  sql,
  onChange,
  schema,
  markers,
  registerInsert,
  onRun,
}: GovernedSqlEditorProps) {
  const { colorMode } = useColorMode();
  // Monaco's bundled VS Code themes verbatim, matching every other editor in
  // the app.
  const theme = colorMode === "dark" ? "vs-dark" : "vs";

  const { handleMount } = useGovernedSqlMonaco({
    schema,
    markers,
    ...(registerInsert ? { registerInsert } : {}),
    ...(onRun ? { onRun } : {}),
  });

  return (
    <Box
      height="full"
      minHeight="220px"
      overflow="hidden"
      data-testid="governed-sql-editor"
    >
      <MonacoEditor
        height="100%"
        language={GOVERNED_SQL_LANGUAGE}
        value={sql}
        theme={theme}
        onChange={(value: string | undefined) => onChange(value ?? "")}
        onMount={handleMount}
        options={EDITOR_OPTIONS}
      />
    </Box>
  );
}
