import { CodePreview } from "@langwatch/design-system/code-preview";
import { Box, chakra, HStack, Text } from "@langwatch/design-system/primitives";
import { Edit2 } from "lucide-react";
import { useState } from "react";

import { CodeEditorModal } from "../optimization_studio/code/workflow-code-editor.transport.tsx";

export interface CodeBlockField {
  identifier: string;
  type: string;
}

export type CodeBlockEditorProps = {
  /** The code to display/edit */
  code: string;
  /** Callback when code changes */
  onChange: (code: string) => void;
  /** Syntax highlighting language */
  language?: string;
  /**
   * If true, the modal is rendered by the parent instead of internally.
   * Use with onEditClick to handle modal state externally.
   * This is needed when CodeBlockEditor is inside a Drawer to avoid focus conflicts.
   */
  externalModal?: boolean;
  /**
   * Called when the edit button is clicked. Use with externalModal=true
   * to open the modal from the parent component.
   */
  onEditClick?: () => void;
  /**
   * Declared node inputs — surfaced in the Monaco editor as known locals so
   * autocomplete and the contract validator have something to anchor on.
   */
  inputs?: readonly CodeBlockField[];
  /**
   * Declared node outputs — surfaced as `"key"` snippets inside `return {…}`
   * and warned on when missing from the source.
   */
  outputs?: readonly CodeBlockField[];
  /**
   * Stable identifier (e.g. the node id) used as the localStorage key for
   * persisting cursor/scroll/folding state across modal opens. Falls back to
   * a per-instance random id if omitted, meaning state is not preserved.
   */
  viewStateKey?: string;
};

/**
 * Reusable code editor with syntax highlighting and full-screen modal.
 * Used in BasePropertiesPanel and AgentCodeEditorDrawer.
 */
export function CodeBlockEditor({
  code,
  onChange,
  language = "python",
  externalModal = false,
  onEditClick,
  inputs,
  outputs,
  viewStateKey,
}: CodeBlockEditorProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (externalModal) {
      onEditClick?.();
    } else {
      setIsModalOpen(true);
    }
  };
  const handleClose = () => {
    setIsModalOpen(false);
  };

  return (
    <Box position="relative" width="full">
      {/* Edit overlay - appears on hover */}
      <chakra.button
        type="button"
        display="flex"
        alignItems="center"
        justifyContent="center"
        aria-label="Edit code"
        onClick={handleOpen}
        position="absolute"
        top={0}
        left={0}
        width="100%"
        height="100%"
        background="bg.scrim"
        zIndex={10}
        opacity={0}
        cursor="pointer"
        transition="opacity 0.2s ease-in-out"
        _hover={{
          opacity: 1,
        }}
      >
        <HStack
          gap={2}
          fontSize="18px"
          fontWeight="bold"
          color="fg"
          background="bg.card"
          paddingY={2}
          paddingX={4}
          borderRadius="6px"
        >
          <Edit2 size={20} />
          <Text>Edit</Text>
        </HStack>
      </chakra.button>

      {/* Code preview */}
      <CodePreview
        code={code}
        language={language}
        filename={`code.${language === "python" ? "py" : language}`}
        maxHeight="200px"
        lineNumbers
        compact
      />

      {/* Editor modal - only render internally when not using external modal */}
      {!externalModal && (
        <CodeEditorModal
          code={code}
          setCode={onChange}
          open={isModalOpen}
          onClose={handleClose}
          inputs={inputs}
          outputs={outputs}
          viewStateKey={viewStateKey}
        />
      )}
    </Box>
  );
}
