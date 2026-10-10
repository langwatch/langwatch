type MonacoEditorInstance = { getDomNode(): HTMLElement | null };

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
