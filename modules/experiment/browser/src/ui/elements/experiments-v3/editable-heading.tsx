import { PageLayout } from "@langwatch/design-system/page-layout";
import { Box, HStack, Input, Skeleton } from "@langwatch/design-system/primitives";
import { Edit2 } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";

type EditableHeadingProps = {
  value: string;
  onSave: (newValue: string) => void;
  isLoading?: boolean;
  /** Shown, muted, while the value is empty; also the input's placeholder. */
  placeholder?: string;
};

/** The page's title, renamed in place: click it to edit, Enter saves, Escape cancels. */
export function EditableHeading({
  value,
  onSave,
  isLoading = false,
  placeholder,
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

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      handleFinishEdit();
    }
    if (event.key === "Escape") {
      handleCancel();
    }
  };

  if (isLoading) {
    return <Skeleton height="28px" width="180px" flexShrink={0} />;
  }

  if (isEditing) {
    return (
      <Input
        ref={inputRef}
        data-testid="experiment-name-input"
        value={editingValue}
        onChange={(e) => setEditingValue(e.target.value)}
        onBlur={handleFinishEdit}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        textStyle="pageTitle"
        variant="flushed"
        width="auto"
        minWidth="240px"
        height="28px"
      />
    );
  }

  return (
    <HStack
      cursor="pointer"
      data-testid="experiment-name-edit"
      onClick={handleStartEdit}
      minWidth={0}
      _hover={{ "& .edit-icon": { color: "fg" } }}
    >
      <PageLayout.Heading color={value ? undefined : "fg.subtle"}>
        {value || placeholder || ""}
      </PageLayout.Heading>
      {/* Always shown, so the title reads as renameable at a glance. */}
      <Box
        className="edit-icon"
        display="flex"
        transition="color 0.15s"
        color="fg.muted"
        aria-hidden
      >
        <Edit2 size={16} />
      </Box>
    </HStack>
  );
}
