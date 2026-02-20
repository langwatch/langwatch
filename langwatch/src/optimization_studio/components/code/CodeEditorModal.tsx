import { Button, HStack } from "@chakra-ui/react";
import { Prism } from "prism-react-renderer";
import { Dialog } from "../../../components/ui/dialog";

(typeof global !== "undefined" ? global : window).Prism = Prism;
require("prismjs/components/prism-python");

import dynamic from "next/dynamic";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => <div style={{ padding: "0 16px" }}>Loading editor...</div>,
});

import { registerCompletion } from "monacopilot";
import { useCallback, useEffect, useRef, useState } from "react";

/** Minimal type for the Monaco editor instance (from @monaco-editor/react onMount) */
type MonacoEditorInstance = {
  focus: () => void;
  trigger: (source: string, handlerId: string, payload: unknown) => void;
  onKeyDown: (handler: (e: { code: string; preventDefault: () => void; stopPropagation: () => void }) => void) => void;
};
import { SecretsIndicator } from "../../../components/secrets/SecretsIndicator";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import monokaiTheme from "./Monokai.json";

export function CodeEditorModal({
  code,
  setCode,
  open,
  onClose,
}: {
  code: string;
  setCode: (code: string) => void;
  open: boolean;
  onClose: () => void;
}) {
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
        margin="64px"
        minWidth="calc(100vw - 128px)"
        height="calc(100vh - 128px)"
        background="#272822"
        color="white"
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
              <Dialog.CloseTrigger
                position="relative"
                top="unset"
                right="unset"
                color="white"
                _hover={{ color: "black" }}
              />
            </HStack>
          </HStack>
        </Dialog.Header>
        <Dialog.Body padding="0">
          {open && (
            <CodeEditor
              code={localCode}
              setCode={setLocalCode}
              onClose={onClose_}
              language="python"
              technologies={["python", "dspy"]}
              onEditorMount={(ed) => {
                editorRef.current = ed;
              }}
            />
          )}
        </Dialog.Body>
        <Dialog.Footer>
          <Button
            onClick={handleSave}
            variant="outline"
            color="white"
            colorPalette="white"
            size="lg"
            _hover={{ color: "black" }}
          >
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

export function CodeEditor({
  code,
  setCode,
  onClose,
  language,
  technologies,
  onEditorMount,
}: {
  code: string;
  setCode: (code: string) => void;
  onClose: () => void;
  language: string;
  technologies: string[];
  onEditorMount?: (editor: MonacoEditorInstance) => void;
}) {
  const { project } = useOrganizationTeamProject();

  useEffect(() => {
    onKeyDown.fn = onClose;
  }, [onClose]);

  return (
    <MonacoEditor
      height="100%"
      defaultLanguage={language}
      defaultValue={code}
      onChange={(code) => code && setCode(code)}
      theme="monokai"
      beforeMount={(monaco) => {
        monaco.editor.defineTheme("monokai", monokaiTheme as any);
      }}
      onMount={(editor, monaco) => {
        editor.focus();
        onEditorMount?.(editor);
        editor.onKeyDown((e) => {
          if (e.code === "Escape") {
            onKeyDown.fn();
            e.preventDefault();
            e.stopPropagation();
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
        padding: {
          top: 0,
        },
      }}
    />
  );
}
