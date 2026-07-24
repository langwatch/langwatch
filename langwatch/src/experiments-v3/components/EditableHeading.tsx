import { Box, Heading, HStack, Input, Skeleton } from "@chakra-ui/react";
import { Edit2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type EditableHeadingProps = {
  value: string;
  onSave: (newValue: string) => void;
  isLoading?: boolean;
};

/**
 * EditableHeading - A heading that can be clicked to edit inline.
 *
 * Shows a pencil icon on hover to indicate editability.
 * Clicking transforms it into an input field.
 * Saves on blur or Enter, cancels on Escape.
 * Shows a skeleton when loading an existing evaluation.
 */
export function EditableHeading({
  value,
  onSave,
  isLoading = false,
}: EditableHeadingProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editingValue, setEditingValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleStartEdit = () => {
    setEditingValue(value || "");
    setIsEditing(true);
  };

  const handleFinishEdit = () => {
    const trimmedValue = editingValue.trim();
    // Save if there's a value and it's different from current
    if (trimmedValue && trimmedValue !== value) {
      onSave(trimmedValue);
    }
    setIsEditing(false);
    setEditingValue("");
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditingValue("");
  };

  if (isLoading) {
    return <Skeleton height="28px" width="180px" />;
  }

  if (isEditing) {
    return (
      <Input
        ref={inputRef}
        value={editingValue}
        onChange={(e) => setEditingValue(e.target.value)}
        onBlur={handleFinishEdit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            handleFinishEdit();
          }
          if (e.key === "Escape") {
            handleCancel();
          }
        }}
        fontSize="md"
        fontWeight="500"
        variant="flushed"
        width="auto"
        minWidth="200px"
        marginY={-2}
      />
    );
  }

  return (
    <HStack
      cursor="pointer"
      onClick={handleStartEdit}
      _hover={{ "& .edit-icon": { opacity: 1 } }}
    >
      <Heading size="md">{value || ""}</Heading>
      <Box
        className="edit-icon"
        opacity={0}
        transition="opacity 0.2s"
        color="fg.subtle"
      >
        <Edit2 size={14} />
      </Box>
    </HStack>
  );
}
