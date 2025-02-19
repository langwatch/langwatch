import {
  Modal,
  ModalOverlay,
  ModalHeader,
  ModalContent,
  ModalBody,
  ModalCloseButton,
  ModalFooter,
  Button,
} from "@chakra-ui/react";

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
  isOpen,
  onClose,
}: {
  code: string;
  setCode: (code: string) => void;
  isOpen: boolean;
  onClose: () => void;
}) {
  const [localCode, setLocalCode] = useState(code);

  useEffect(() => {
    setLocalCode(code);
  }, [code, isOpen]);

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

    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [handleSave, isOpen, localCode]);

  return (
    <Modal isOpen={isOpen} onClose={onClose_}>
      <ModalOverlay />
      <ModalContent
        margin="64px"
        minWidth="calc(100vw - 128px)"
        height="calc(100vh - 128px)"
        background="#272822"
        color="white"
      >
        <ModalHeader>Edit Code</ModalHeader>
        <ModalCloseButton />
        <ModalBody padding="0">
          {isOpen && (
            <CodeEditor
              code={localCode}
              setCode={setLocalCode}
              onClose={onClose_}
            />
          )}
        </ModalBody>
        <ModalFooter>
          <Button
            onClick={handleSave}
            variant="outline"
            colorScheme="white"
            size="lg"
          >
            Save
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
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
