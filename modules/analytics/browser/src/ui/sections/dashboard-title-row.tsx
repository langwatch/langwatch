import { Box, Heading, HStack, Input } from "@langwatch/design-system/primitives";
import { Edit2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { DashboardActionsMenu } from "./custom-dashboards-section.tsx";

export interface DashboardTitleRowProps {
  title: string;
  projectSlug: string;
  /** The dashboard on screen; without one (a missing dashboard) the row offers no actions. */
  dashboardId?: string;
  isEditable?: boolean;
  onTitleSave?: (newTitle: string) => void;
}

/** A custom dashboard's name under the Analytics header, renamed in place, actions beside it. */
export function DashboardTitleRow({
  title,
  projectSlug,
  dashboardId,
  isEditable = false,
  onTitleSave,
}: DashboardTitleRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editingTitle, setEditingTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const startEdit = () => {
    if (!isEditable) return;
    setEditingTitle(title);
    setIsEditing(true);
  };
  const finishEdit = () => {
    if (editingTitle.trim() && editingTitle !== title) onTitleSave?.(editingTitle.trim());
    setIsEditing(false);
    setEditingTitle("");
  };

  return (
    <HStack data-testid="analytics-dashboard-title" gap={1} minHeight="36px" marginBottom={3}>
      {isEditing ? (
        <Input
          ref={inputRef}
          data-testid="analytics-dashboard-rename-input"
          value={editingTitle}
          onChange={(e) => setEditingTitle(e.target.value)}
          onBlur={finishEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") finishEdit();
            if (e.key === "Escape") {
              setIsEditing(false);
              setEditingTitle("");
            }
          }}
          fontSize="md"
          fontWeight="medium"
          variant="flushed"
          width="auto"
          minWidth="240px"
        />
      ) : (
        <HStack
          gap={2}
          minWidth={0}
          cursor={isEditable ? "pointer" : "default"}
          onClick={startEdit}
          _hover={isEditable ? { "& .edit-icon": { opacity: 1 } } : void 0}
        >
          <Heading as="h2" fontSize="16px" lineHeight="24px" fontWeight="semibold" truncate>
            {title}
          </Heading>
          {isEditable ? (
            <Box className="edit-icon" opacity={0} transition="opacity 0.2s" color="fg.subtle">
              <Edit2 size={14} />
            </Box>
          ) : null}
        </HStack>
      )}
      {dashboardId && !isEditing ? (
        <DashboardActionsMenu
          projectSlug={projectSlug}
          dashboardId={dashboardId}
          onRename={isEditable ? startEdit : void 0}
        />
      ) : null}
    </HStack>
  );
}
