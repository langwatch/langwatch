import { Button } from "@chakra-ui/react";
import { Dialog } from "../../../components/ui/dialog";

require("prismjs/components/prism-python");

import dynamic from "next/dynamic";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => <div style={{ padding: "0 16px" }}>Loading editor...</div>,
});

import monokaiTheme from "./Monokai.json";
import { useCallback, useEffect, useState } from "react";

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
  const [localCode, setLocalCode] = useState(code);

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

  return (
    <Dialog.Root open={open} onOpenChange={({ open }) => !open && onClose_()}>
      <Dialog.Backdrop />
      <Dialog.Content
        margin="64px"
        minWidth="calc(100vw - 128px)"
        height="calc(100vh - 128px)"
        background="#272822"
        color="white"
      >
        <Dialog.Header>
          <Dialog.Title>Edit Code</Dialog.Title>
          <Dialog.CloseTrigger />
        </Dialog.Header>
        <Dialog.Body padding="0">
          {open && (
            <CodeEditor
              code={localCode}
              setCode={setLocalCode}
              onClose={onClose_}
            />
          )}
        </Dialog.Body>
        <Dialog.Footer>
          <Button
            onClick={handleSave}
            variant="outline"
            colorPalette="white"
            size="lg"
          >
            Save
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

const onKeyDown = {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  fn: () => {},
};

function CodeEditor({
  code,
  setCode,
  onClose,
}: {
  code: string;
  setCode: (code: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    onKeyDown.fn = onClose;
  }, [onClose]);

  return (
    <MonacoEditor
      height="100%"
      defaultLanguage="python"
      defaultValue={code}
      onChange={(code) => code && setCode(code)}
      theme="monokai"
      beforeMount={(monaco) => {
        monaco.editor.defineTheme("monokai", monokaiTheme as any);
      }}
      onMount={(editor) => {
        editor.focus();
        editor.onKeyDown((e) => {
          if (e.code === "Escape") {
            onKeyDown.fn();
            e.preventDefault();
            e.stopPropagation();
          }
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
