import type { LangWatchQLSchema } from "@langwatch/analytics-contract";
import type { Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useEffect, useRef } from "react";

import type { LwqlParameter } from "../model/lwql-language/lwql-completion.ts";
import type { LwqlEditorMarker } from "../model/lwql-language/lwql-marker.ts";
import {
  applyLwqlMarkers,
  clearLwqlModelState,
  paramDecorations,
  setLwqlModelState,
} from "./lwql-monaco.ts";

export type LwqlMountedEditor = Readonly<{
  monaco: Monaco;
  editor: editor.IStandaloneCodeEditor;
}>;

/** Keeps a mounted editor's model in step with the schema, parameters, markers and text. */
export function useLwqlModelSync({
  mounted,
  schema,
  parameters,
  markers,
  value,
}: {
  mounted: LwqlMountedEditor | null;
  schema: LangWatchQLSchema | undefined;
  parameters: readonly LwqlParameter[];
  markers: readonly LwqlEditorMarker[];
  value: string;
}): void {
  const decorations = useRef<editor.IEditorDecorationsCollection | null>(null);

  useEffect(() => {
    const model = mounted?.editor.getModel();
    if (!mounted || !model) return;
    setLwqlModelState({ monaco: mounted.monaco, model, schema, parameters });
  }, [mounted, schema, parameters]);

  useEffect(() => {
    const model = mounted?.editor.getModel();
    if (!mounted || !model) return;
    applyLwqlMarkers({ monaco: mounted.monaco, model, markers });
  }, [mounted, markers]);

  // value is a dependency on purpose: typing or a param edit re-colours the tokens.
  useEffect(() => {
    const model = mounted?.editor.getModel();
    if (!mounted || !model) return;
    const next = paramDecorations({ model, parameters });
    if (decorations.current) decorations.current.set(next);
    else decorations.current = mounted.editor.createDecorationsCollection(next);
  }, [mounted, parameters, value]);

  useEffect(() => {
    const model = mounted?.editor.getModel();
    return () => {
      if (model) clearLwqlModelState(model);
    };
  }, [mounted]);
}
