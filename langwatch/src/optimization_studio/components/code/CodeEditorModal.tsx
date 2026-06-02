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
import { registerCompletion } from "monacopilot";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useColorMode } from "~/components/ui/color-mode";
import { SecretsIndicator } from "../../../components/secrets/SecretsIndicator";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import {
  registerPythonProviders,
  type PythonField,
  type PythonProviderHandle,
} from "./monaco/registerPythonProviders";
import { defineLangwatchThemes, themeNameForColorMode } from "./monaco/themes";

/** Minimal type for the Monaco editor instance (from @monaco-editor/react onMount) */
type MonacoEditorInstance = {
  focus: () => void;
  trigger: (source: string, handlerId: string, payload: unknown) => void;
  onKeyDown: (
    handler: (e: {
      code: string;
      preventDefault: () => void;
      stopPropagation: () => void;
    }) => void,
  ) => void;
  getAction: (id: string) => { run: () => void } | null;
};

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
}: {
  code: string;
  setCode: (code: string) => void;
  open: boolean;
  onClose: () => void;
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
              language="python"
              technologies={["python", "dspy"]}
              inputs={inputs}
              outputs={outputs}
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

const EMPTY_FIELDS: readonly PythonField[] = [];

export function CodeEditor({
  code,
  setCode,
  onClose,
  language,
  technologies,
  inputs,
  outputs,
  onEditorMount,
}: {
  code: string;
  setCode: (code: string) => void;
  onClose: () => void;
  language: string;
  technologies: string[];
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
      onChange={(code: any) => code && setCode(code)}
      theme={themeNameForColorMode(colorMode)}
      beforeMount={(monaco: Monaco) => {
        defineLangwatchThemes(monaco);
      }}
      onMount={(editor: any, monaco: Monaco) => {
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

        editor.onKeyDown((e: any) => {
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
        formatOnPaste: true,
        formatOnType: false,
        padding: {
          top: 0,
        },
      }}
    />
  );
}
