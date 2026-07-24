import type { Editor } from "@tiptap/react";
import { useEffect } from "react";

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  );
}

export function useGlobalSlashFocus(editor: Editor | null): void {
  useEffect(() => {
    if (!editor) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "/") return;
      if (isTextInputTarget(event.target)) return;
      event.preventDefault();
      editor.commands.focus();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [editor]);
}
