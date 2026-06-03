import { Button, HStack } from "@chakra-ui/react";
import { Prism } from "prism-react-renderer";
import { Dialog } from "../../../components/ui/dialog";

(typeof global !== "undefined" ? global : window).Prism = Prism;
// Dynamic import — must happen after Prism is set on globalThis (ESM imports hoist above runtime code)
// @ts-ignore — prismjs component modules lack type declarations
void import("prismjs/components/prism-python");

import dynamic from "~/utils/compat/next-dynamic";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => <div style={{ padding: "0 16px" }}>Loading editor...</div>,
});

import type { Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { registerCompletion } from "monacopilot";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useColorMode } from "~/components/ui/color-mode";
import { SecretsIndicator } from "../../../components/secrets/SecretsIndicator";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { registerPythonProviders } from "./monaco/registerPythonProviders";
import type {
  PythonField,
  PythonProviderHandle,
} from "./monaco/python/shared";

/**
 * Use Monaco's bundled VS Code themes verbatim — `vs` for light, `vs-dark`
 * for dark. Matches what users get in VS Code out of the box.
 */
function vscodeThemeName(colorMode: "light" | "dark"): string {
  return colorMode === "dark" ? "vs-dark" : "vs";
}

/**
 * Re-export Monaco's own standalone-editor type under a project-local alias
 * so consumers (e.g. `onEditorMount` callback in CodeBlockEditor) don't have
 * to depend on the `monaco-editor` package directly.
 */
type MonacoEditorInstance = editor.IStandaloneCodeEditor;

interface ContractProps {
  /** Node inputs — declared in the Inputs section of the properties panel. */
  inputs?: readonly PythonField[];
  /** Node outputs — declared in the Outputs section of the properties panel. */
  outputs?: readonly PythonField[];
}

export function CodeEditorModal({
  code,
  setCode,
  open,
  onClose,
  inputs,
  outputs,
  viewStateKey,
}: {
  code: string;
  setCode: (code: string) => void;
  open: boolean;
  onClose: () => void;
  /** Stable id used to persist cursor/scroll state across modal opens. */
  viewStateKey?: string;
} & ContractProps) {
  const { project } = useOrganizationTeamProject();
  const [localCode, setLocalCode] = useState(code);
  const editorRef = useRef<MonacoEditorInstance | null>(null);

  useEffect(() => {
    setLocalCode(code);
  }, [code, open]);

  const handleSave = useCallback(() => {
    setCode(localCode);
    onClose();
  }, [localCode, setCode, onClose]);

  const onClose_ = useCallback(() => {
    if (localCode !== code) {
      if (!window.confirm("Your changes will be lost. Are you sure?")) {
        return;
      }
    }
    onClose();
  }, [localCode, code, onClose]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };

    if (open) {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [handleSave, open, localCode]);

  const insertAtCursor = useCallback((text: string) => {
    const ed = editorRef.current;
    if (!ed) return;
    ed.focus();
    ed.trigger("keyboard", "type", { text });
  }, []);

  const handleInsertSecret = useCallback(
    (secretName: string) => {
      insertAtCursor(`secrets.${secretName}`);
    },
    [insertAtCursor],
  );

  return (
    <Dialog.Root open={open} onOpenChange={({ open }) => !open && onClose_()}>
      <Dialog.Content
        bg="bg"
        margin="64px"
        minWidth="calc(100vw - 128px)"
        height="calc(100vh - 128px)"
        positionerProps={{
          zIndex: 1502,
        }}
      >
        <Dialog.Header>
          <HStack justify="space-between" width="full">
            <Dialog.Title>Edit Code</Dialog.Title>
            <HStack gap={1}>
              {project?.id && (
                <SecretsIndicator
                  projectId={project.id}
                  onInsertSecret={handleInsertSecret}
                />
              )}
              <Dialog.CloseTrigger position="relative" top="unset" right="unset" />
            </HStack>
          </HStack>
        </Dialog.Header>
        <Dialog.Body padding="0">
          {open && (
            <CodeEditor
              code={localCode}
              setCode={setLocalCode}
              onClose={onClose_}
              onSave={handleSave}
              language="python"
              technologies={["python", "dspy"]}
              inputs={inputs}
              outputs={outputs}
              viewStateKey={viewStateKey}
              onEditorMount={(ed) => {
                editorRef.current = ed;
              }}
            />
          )}
        </Dialog.Body>
        <Dialog.Footer>
          <Button onClick={handleSave} variant="outline" size="lg">
            Save
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

const onKeyDown = {
  // biome-ignore lint/suspicious/noEmptyBlockStatements: this is a fair use case for a function expression as a third party client may need to access the fn property of the object.
  fn: () => {},
};

const onSave = {
  // biome-ignore lint/suspicious/noEmptyBlockStatements: same pattern as onKeyDown — a mutable handler stub that the latest CodeEditor mount keeps in sync.
  fn: () => {},
};

const EMPTY_FIELDS: readonly PythonField[] = [];

export function CodeEditor({
  code,
  setCode,
  onClose,
  onSave: onSaveProp,
  language,
  technologies,
  inputs,
  outputs,
  viewStateKey,
  onEditorMount,
}: {
  code: string;
  setCode: (code: string) => void;
  onClose: () => void;
  onSave?: () => void;
  language: string;
  technologies: string[];
  viewStateKey?: string;
  onEditorMount?: (editor: MonacoEditorInstance) => void;
} & ContractProps) {
  const { project } = useOrganizationTeamProject();
  const { colorMode } = useColorMode();
  const providersRef = useRef<PythonProviderHandle | null>(null);

  // Live-fetched secret names; passed into the completion provider so
  // `secrets.<Tab>` suggests names the moment they appear in Settings.
  const secretsQuery = api.secrets.list.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );
  const secretNames = useMemo(
    () => (secretsQuery.data ?? []).map((s) => s.name),
    [secretsQuery.data],
  );

  const inputFields = inputs ?? EMPTY_FIELDS;
  const outputFields = outputs ?? EMPTY_FIELDS;

  useEffect(() => {
    onKeyDown.fn = onClose;
  }, [onClose]);

  useEffect(() => {
    onSave.fn = onSaveProp ?? (() => {});
  }, [onSaveProp]);

  useEffect(() => {
    providersRef.current?.setContract({
      secretNames,
      inputs: inputFields,
      outputs: outputFields,
    });
  }, [secretNames, inputFields, outputFields]);

  useEffect(() => {
    return () => {
      providersRef.current?.dispose();
      providersRef.current = null;
    };
  }, []);

  return (
    <MonacoEditor
      height="100%"
      defaultLanguage={language}
      defaultValue={code}
      onChange={(value: string | undefined) => {
        // Monaco hands us `string | undefined`; treat undefined as empty so
        // deleting everything still propagates state.
        setCode(value ?? "");
      }}
      theme={vscodeThemeName(colorMode)}
      onMount={(editor: MonacoEditorInstance, monaco: Monaco) => {
        // Restore previously-saved cursor/scroll/folding state so reopening
        // the modal for the same node drops the user back where they were.
        if (viewStateKey) {
          try {
            const raw = localStorage.getItem(
              `langwatch.monaco.viewstate:${viewStateKey}`,
            );
            if (raw) editor.restoreViewState(JSON.parse(raw));
          } catch {
            // ignore corrupted state
          }
        }
        editor.focus();
        onEditorMount?.(editor);

        if (language === "python") {
          providersRef.current?.dispose();
          providersRef.current = registerPythonProviders({
            monaco,
            contract: {
              secretNames,
              inputs: inputFields,
              outputs: outputFields,
            },
          });
        }

        // React Flow's `panActivationKeyCode` defaults to `Space`, so it
        // registers a document-level keydown handler that preventDefaults
        // every Space — which swallows the keystroke before the browser
        // turns it into a `beforeinput` for Monaco. Shield ONLY Space (and
        // not the other ~dozen keys React Flow watches) so editor shortcuts
        // that legitimately bubble (Cmd+A select-all, Cmd+Z undo, etc.) still
        // reach Monaco's standalone keybinding service above the editor root.
        const editorRoot = editor.getDomNode?.();
        const shieldSpace = (e: KeyboardEvent) => {
          if (e.code === "Space" && !e.metaKey && !e.ctrlKey && !e.altKey) {
            e.stopPropagation();
          }
        };
        if (editorRoot) {
          editorRoot.addEventListener("keydown", shieldSpace);
          editorRoot.addEventListener("keypress", shieldSpace);
          editorRoot.addEventListener("keyup", shieldSpace);
          editor.onDidDispose?.(() => {
            editorRoot.removeEventListener("keydown", shieldSpace);
            editorRoot.removeEventListener("keypress", shieldSpace);
            editorRoot.removeEventListener("keyup", shieldSpace);
          });
        }

        // Drag-and-drop secret chips from SecretsIndicator. The chip puts the
        // secret name on the dataTransfer; we translate the drop point into
        // an editor position and insert `secrets.NAME` there.
        if (editorRoot) {
          const onDragOver = (e: DragEvent) => {
            if (
              e.dataTransfer?.types.includes("text/x-langwatch-secret")
            ) {
              e.preventDefault();
              if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
            }
          };
          const onDrop = (e: DragEvent) => {
            const name = e.dataTransfer?.getData("text/x-langwatch-secret");
            if (!name) return;
            e.preventDefault();
            const target = editor.getTargetAtClientPoint?.(e.clientX, e.clientY);
            const pos = target?.position ?? editor.getPosition();
            if (!pos) return;
            editor.focus();
            editor.executeEdits("secret-drop", [
              {
                range: {
                  startLineNumber: pos.lineNumber,
                  endLineNumber: pos.lineNumber,
                  startColumn: pos.column,
                  endColumn: pos.column,
                },
                text: `secrets.${name}`,
                forceMoveMarkers: true,
              },
            ]);
          };
          editorRoot.addEventListener("dragover", onDragOver);
          editorRoot.addEventListener("drop", onDrop);
          editor.onDidDispose?.(() => {
            editorRoot.removeEventListener("dragover", onDragOver);
            editorRoot.removeEventListener("drop", onDrop);
          });
        }

        // Persist view state on dispose. Doing it here (rather than on every
        // edit) keeps writes cheap; the editor is short-lived inside a modal
        // so dispose fires reliably on close.
        if (viewStateKey) {
          editor.onDidDispose?.(() => {
            try {
              const state = editor.saveViewState();
              if (state) {
                localStorage.setItem(
                  `langwatch.monaco.viewstate:${viewStateKey}`,
                  JSON.stringify(state),
                );
              }
            } catch {
              // localStorage quota / serialisation — silently skip
            }
          });
        }

        editor.onKeyDown((e) => {
          if (e.code === "Escape") {
            onKeyDown.fn();
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          // Cmd/Ctrl+S or Cmd/Ctrl+Enter both Save & Close. Mirrors VS Code's
          // save shortcut + the Notebook "run cell" muscle memory.
          if (
            (e.metaKey || e.ctrlKey) &&
            (e.code === "KeyS" || e.code === "Enter" || e.code === "NumpadEnter")
          ) {
            e.preventDefault();
            e.stopPropagation();
            onSave.fn();
          }
        });
        registerCompletion(monaco, editor, {
          language,
          endpoint: `/api/workflows/code-completion?projectId=${project?.id}`,
          technologies,
        });
      }}
      options={{
        minimap: { enabled: false },
        fontSize: 14,
        wordWrap: "on",
        automaticLayout: true,
        formatOnPaste: true,
        formatOnType: false,
        // Only Tab/Enter accept a highlighted suggestion. Without this, the
        // default `true` makes punctuation (including space) auto-accept,
        // which swallows the keystroke whenever the suggest widget is open —
        // unusable for normal typing.
        acceptSuggestionOnCommitCharacter: false,
        // Surface the quick-fix lightbulb whenever our code-action provider
        // has fixes for the current line's diagnostics. `editor.ShowLightbulbIconMode.On`
        // is the string-enum value `"on"` — on both code lines and empty lines.
        lightbulb: { enabled: "on" as editor.ShowLightbulbIconMode },
        // VS Code parity polish: coloured brackets, indent + bracket guides,
        // sticky scroll so `class Code` / `def __call__` stay pinned at the
        // top while reading deep into a method, and a 100-column ruler that
        // matches the most common Python line-length convention.
        bracketPairColorization: { enabled: true },
        guides: {
          indentation: true,
          bracketPairs: true,
          bracketPairsHorizontal: "active",
        },
        stickyScroll: { enabled: true },
        rulers: [100],
        smoothScrolling: true,
        cursorBlinking: "smooth",
        cursorSmoothCaretAnimation: "on",
        renderLineHighlight: "all",
        // Show the parameter hint widget on call open and re-trigger between
        // arguments.
        parameterHints: { enabled: true, cycle: true },
        tabSize: 4,
        insertSpaces: true,
        padding: {
          top: 0,
        },
      }}
    />
  );
}
