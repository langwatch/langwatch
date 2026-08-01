import type { OnMount } from "@monaco-editor/react";

type MonacoEditorInstance = Parameters<OnMount>[0];

/** Monaco's built-in `vs-dark` editor background. Kept as the single hex
 *  constant next to the theme plumbing — wrapper Boxes must use
 *  `monacoBackgroundFor(theme)` instead of repeating the literal. */
const MONACO_DARK_BACKGROUND = "#1e1e1e";

/** Background colour for the Box wrapping a Monaco editor, matched to the
 *  theme name `useMonacoTheme()` returns so the chrome around the editor
 *  never drifts from Monaco's own canvas colour. */
export function monacoBackgroundFor(theme: "vs-dark" | "vs"): string {
  return theme === "vs-dark" ? MONACO_DARK_BACKGROUND : "white";
}

/**
 * Escape inside Monaco normally bubbles up to the surrounding Drawer and
 * closes it, which costs the author every unsaved edit in one keystroke.
 * Trap Escape at the editor's DOM root and stop propagation; Monaco's own
 * handlers (close completion popup, exit suggest) still fire because they
 * run on the editor's command bus, not on the bubbling DOM event.
 */
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
    // `capture: true` so Chakra/Radix `Dialog.Content`'s own bubble-phase
    // Escape handler (which closes the drawer) never sees it.
    { capture: true },
  );
}
