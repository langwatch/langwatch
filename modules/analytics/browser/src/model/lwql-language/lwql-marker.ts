/** One diagnostic to draw in the editor, positioned as the server reports it (1-based). */
export type LwqlEditorMarker = Readonly<{
  message: string;
  severity?: "error" | "warning" | "info";
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
}>;
