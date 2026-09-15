type MonacoEditorInstance = { getDomNode(): HTMLElement | null };

/** Monaco's built-in `vs-dark` background. */
const MONACO_DARK_BACKGROUND = "#1e1e1e";

/** Keeps surrounding editor chrome aligned with Monaco's canvas. */
export function monacoBackgroundFor(theme: "vs-dark" | "vs"): string {
  return theme === "vs-dark" ? MONACO_DARK_BACKGROUND : "white";
}

/** Prevents Monaco's Escape key from closing the containing drawer. */
export function trapEscapeInsideEditor(editor: MonacoEditorInstance): void {
  const editorEl = editor.getDomNode();
  if (!editorEl) return;
  editorEl.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
      }
    },
    // The containing drawer handles Escape during bubbling.
    { capture: true },
  );
}
