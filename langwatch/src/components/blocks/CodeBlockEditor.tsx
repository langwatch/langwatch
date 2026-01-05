import { Box, Center, HStack, Text } from "@chakra-ui/react";
import { Edit2 } from "lucide-react";
import { useState } from "react";
import { RenderCode } from "../code/RenderCode";
import { CodeEditorModal } from "../../optimization_studio/components/code/CodeEditorModal";

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
};

/**
 * CodeBlockEditor - A reusable component for displaying and editing code.
 *
 * Displays a syntax-highlighted preview with an "Edit" overlay on hover.
 * Clicking opens a full-screen Monaco editor modal.
 *
 * Used in:
 * - BasePropertiesPanel for workflow code fields
 * - AgentCodeEditorDrawer for code-based agents
 */
export function CodeBlockEditor({
  code,
  onChange,
  language = "python",
  externalModal = false,
  onEditClick,
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
      <Center
        role="button"
        aria-label="Edit code"
        onClick={handleOpen}
        position="absolute"
        top={0}
        left={0}
        width="100%"
        height="100%"
        background="rgba(0, 0, 0, 0.2)"
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
          color="white"
          background="rgba(0, 0, 0, .5)"
          paddingY={2}
          paddingX={4}
          borderRadius="6px"
        >
          <Edit2 size={20} />
          <Text>Edit</Text>
        </HStack>
      </Center>

      {/* Code preview */}
      <RenderCode
        code={code}
        language={language}
        style={{
          width: "100%",
          fontSize: "12px",
          padding: "12px",
          borderRadius: "8px",
          backgroundColor: "rgb(39, 40, 34)",
          maxHeight: "200px",
          overflowY: "hidden",
        }}
      />

      {/* Editor modal - only render internally when not using external modal */}
      {!externalModal && (
        <CodeEditorModal
          code={code}
          setCode={onChange}
          open={isModalOpen}
          onClose={handleClose}
        />
      )}
    </Box>
  );
}
