import { Box, HStack, Text } from "@chakra-ui/react";
import { LuFileCode, LuX } from "react-icons/lu";
import { Prism } from "prism-react-renderer";
import { Dialog } from "../../../components/ui/dialog";
import { EditorStatusBar } from "./EditorStatusBar";

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
export function vscodeThemeName(colorMode: "light" | "dark"): string {
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
  // Kept in component state (not just refs) so the status bar re-renders when
  // the editor mounts. The status bar subscribes to the editor + monaco events
  // for cursor / marker updates itself, so we only need the initial bind here.
  const [editorInstance, setEditorInstance] =
    useState<MonacoEditorInstance | null>(null);
  const [monacoInstance, setMonacoInstance] = useState<Monaco | null>(null);

  useEffect(() => {
    setLocalCode(code);
  }, [code, open]);

  // Save = persist the buffer back to the parent and keep the modal open so
  // the user can keep editing. Mirrors a file editor's "save" — never closes.
  const handleSave = useCallback(() => {
    setCode(localCode);
  }, [localCode, setCode]);

  // Save & Close = save then dismiss. The deliberate stronger gesture
  // (Cmd+Enter, not Cmd+S) so muscle-memory ⌘S doesn't accidentally close.
  const handleSaveAndClose = useCallback(() => {
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
      // Cmd/Ctrl+S → Save (don't close)
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
        return;
      }
      // Cmd/Ctrl+Enter → Save & Close
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        handleSaveAndClose();
      }
    };

    if (open) {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [handleSave, handleSaveAndClose, open, localCode]);

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
    <Dialog.Root
      open={open}
      onOpenChange={({ open }) => !open && onClose_()}
      // Escape inside Monaco needs to stay with Monaco — it dismisses the
      // suggest widget, hover, parameter hint, multi-cursor, etc. If we
      // let Ark UI's Dialog handler also close the modal on the same
      // keypress, users lose work-in-progress every time they tab through
      // completions. Closing the modal goes through the explicit X
      // button / Save & Close instead.
      closeOnEscape={false}
    >
      <Dialog.Content
        bg="bg"
        margin="32px"
        minWidth="calc(100vw - 64px)"
        height="calc(100vh - 64px)"
        display="flex"
        flexDirection="column"
        overflow="hidden"
        positionerProps={{ zIndex: 1502 }}
      >
        {/* File-tab strip — mimics a single VS Code editor tab so the modal
            reads as "you're editing one file" rather than a generic dialog. */}
        <HStack
          bg="bg.muted"
          borderBottomWidth="1px"
          borderColor="border"
          paddingLeft={0}
          paddingRight={2}
          height="36px"
          gap={0}
          flexShrink={0}
        >
          <HStack
            bg="bg"
            paddingX={3}
            paddingY={1.5}
            gap={2}
            height="full"
            borderRightWidth="1px"
            borderColor="border"
            position="relative"
            _after={{
              content: '""',
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: "2px",
              bg: "blue.400",
            }}
          >
            <LuFileCode size={14} />
            <Text fontSize="13px" fontFamily="mono">
              Code.py
            </Text>
          </HStack>
          <Box flex={1} />
          {project?.id && (
            <SecretsIndicator
              projectId={project.id}
              onInsertSecret={handleInsertSecret}
            />
          )}
          <HStack
            as="button"
            onClick={onClose_}
            aria-label="Close editor"
            padding={1.5}
            borderRadius="sm"
            color="fg.muted"
            _hover={{ bg: "bg.subtle", color: "fg" }}
            data-testid="code-editor-close"
            cursor="pointer"
          >
            <LuX size={16} />
          </HStack>
        </HStack>

        {/* Editor fills the body edge-to-edge — no Dialog.Body padding chrome. */}
        <Box flex={1} minHeight={0}>
          {open && (
            <CodeEditor
              code={localCode}
              setCode={setLocalCode}
              onClose={onClose_}
              onSave={handleSave}
              onSaveAndClose={handleSaveAndClose}
              language="python"
              technologies={["python", "dspy"]}
              inputs={inputs}
              outputs={outputs}
              viewStateKey={viewStateKey}
              onEditorMount={(ed, monaco) => {
                editorRef.current = ed;
                setEditorInstance(ed);
                setMonacoInstance(monaco);
              }}
            />
          )}
        </Box>

        {/* VS Code-style bottom status strip — language, cursor, problem count,
            indentation, encoding, plus both save actions side by side. The
            status bar subscribes to editor + marker events directly. */}
        <EditorStatusBar
          editor={editorInstance}
          monaco={monacoInstance}
          language="python"
          onSave={handleSave}
          onSaveAndClose={handleSaveAndClose}
        />
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

const onSaveAndClose = {
  // biome-ignore lint/suspicious/noEmptyBlockStatements: same pattern — mutable handler stub kept in sync with the latest CodeEditor mount.
  fn: () => {},
};

const EMPTY_FIELDS: readonly PythonField[] = [];

export function CodeEditor({
  code,
  setCode,
  onClose,
  onSave: onSaveProp,
  onSaveAndClose: onSaveAndCloseProp,
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
  /** Persist the buffer without dismissing the editor (⌘S muscle memory). */
  onSave?: () => void;
  /** Persist + dismiss (⌘↵). */
  onSaveAndClose?: () => void;
  language: string;
  technologies: string[];
  viewStateKey?: string;
  onEditorMount?: (editor: MonacoEditorInstance, monaco: Monaco) => void;
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
    onSaveAndClose.fn = onSaveAndCloseProp ?? (() => {});
  }, [onSaveAndCloseProp]);

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
        onEditorMount?.(editor, monaco);

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
          // Escape is INTENTIONALLY not handled here — Monaco itself uses it
          // to dismiss the suggest widget, hover, parameter-hint, etc. If
          // none of those are open, Monaco won't stop propagation and the
          // surrounding Dialog will close on its own. That gives Escape the
          // expected contextual feel: first press closes the open widget,
          // a *second* press dismisses the modal.

          // Cmd/Ctrl+S → Save (keep modal open). Bound here too so the
          // shortcut works even when Monaco has the keystroke captured
          // before it reaches the window-level listener.
          if (
            (e.metaKey || e.ctrlKey) &&
            !e.shiftKey &&
            e.code === "KeyS"
          ) {
            e.preventDefault();
            e.stopPropagation();
            onSave.fn();
            return;
          }
          // Cmd/Ctrl+Enter → Save & Close. Mirrors the Notebook "run cell"
          // muscle memory.
          if (
            (e.metaKey || e.ctrlKey) &&
            (e.code === "Enter" || e.code === "NumpadEnter")
          ) {
            e.preventDefault();
            e.stopPropagation();
            onSaveAndClose.fn();
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
