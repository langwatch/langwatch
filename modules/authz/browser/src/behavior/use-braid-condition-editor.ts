import type { Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useEffect, useSyncExternalStore } from "react";

import {
  applyBraidConditionRefusal,
  clearBraidConditionKeys,
  defineBraidConditionTheme,
  setBraidConditionKeys,
} from "./braid-condition-monaco.ts";

export type BraidConditionMountedEditor = {
  editor: editor.IStandaloneCodeEditor;
  monaco: Monaco;
};

/** The colour mode lands as a class on <html>; its tokens resolve only once it has. */
function subscribeToPageClass(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}
const pageClass = () => document.documentElement.className;

export const braidConditionThemeName = (dark: boolean) =>
  dark ? "braid-condition-dark" : "braid-condition-light";

/**
 * Keeps a mounted editor in step with the field: a value the host changed (the signed calls
 * switch), the owner's keys, the refusal marker and the colour mode's theme. Typing flows out
 * through onChange and is never written back, so a fast typist never loses the completion list.
 */
export function useBraidConditionEditor({
  mounted,
  value,
  attributeKeys,
  refusal,
  dark,
}: {
  mounted: BraidConditionMountedEditor | null;
  value: string;
  attributeKeys: readonly { key: string; spanCount: number }[];
  refusal: { at: number; end: number; message: string } | undefined;
  dark: boolean;
}): void {
  useEffect(() => {
    const current = mounted?.editor;
    if (!current || current.hasTextFocus() || current.getValue() === value) return;
    current.setValue(value);
  }, [mounted, value]);

  useEffect(() => {
    const model = mounted?.editor.getModel();
    if (!model) return;
    setBraidConditionKeys({ model, attributeKeys });
    return () => clearBraidConditionKeys(model);
  }, [mounted, attributeKeys]);

  const { at, end, message } = refusal ?? {};
  useEffect(() => {
    const model = mounted?.editor.getModel();
    if (!mounted || !model) return;
    const marked =
      at !== undefined && end !== undefined && message !== undefined
        ? { at, end, message }
        : undefined;
    applyBraidConditionRefusal({ monaco: mounted.monaco, model, refusal: marked });
  }, [mounted, at, end, message, value]);

  // `dark` flips before the page's class does, so the theme is redefined again once the class
  // lands and the tokens read in the new mode.
  const modeClass = useSyncExternalStore(subscribeToPageClass, pageClass, () => "");
  useEffect(() => {
    if (!mounted) return;
    const name = braidConditionThemeName(dark);
    defineBraidConditionTheme({ monaco: mounted.monaco, name, dark });
    mounted.monaco.editor.setTheme(name);
  }, [mounted, dark, modeClass]);
}
