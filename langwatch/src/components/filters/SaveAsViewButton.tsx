/**
 * SaveAsViewButton -- button next to "Filters" heading that opens a dialog
 * to save the current filter state as a named custom view.
 *
 * Rendered by QueryStringFieldsFilters only when filters are active and
 * ClickHouse is enabled. useSavedViews() is safe here because the parent
 * tree always has SavedViewsProvider when ClickHouse is on.
 */

import { Button, HStack, Input, Text } from "@chakra-ui/react";
import { Check, ChevronDown, User, Users } from "lucide-react";
import React, { useCallback, useRef, useState } from "react";
import { MAX_VIEW_NAME_LENGTH, useSavedViews } from "../../hooks/useSavedViews";
import { Dialog } from "../ui/dialog";
import { Menu } from "../ui/menu";

export function SaveAsViewButton() {
  const { saveView } = useSavedViews();
  const [isOpen, setIsOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const [scope, setScope] = useState<"project" | "myself">("project");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleOpen = useCallback(() => {
    setViewName("");
    setScope("project");
    setIsOpen(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const handleConfirm = useCallback(() => {
    const trimmed = viewName.trim();
    if (!trimmed) return;
    saveView(trimmed, scope);
    setIsOpen(false);
    setViewName("");
  }, [viewName, scope, saveView]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleConfirm();
      }
    },
    [handleConfirm],
  );

  return (
    <>
      <Button
        size="xs"
        variant="outline"
        onClick={handleOpen}
        data-testid="save-as-view-button"
      >
        Save as view
      </Button>

      <Dialog.Root
        open={isOpen}
        onOpenChange={(e) => setIsOpen(e.open)}
        size="sm"
      >
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>Save as view</Dialog.Title>
          </Dialog.Header>
          <Dialog.Body>
            <Input
              ref={inputRef}
              placeholder="View name..."
              value={viewName}
              onChange={(e) =>
                setViewName(e.target.value.slice(0, MAX_VIEW_NAME_LENGTH))
              }
              onKeyDown={handleKeyDown}
              data-testid="save-view-name-input"
            />
          </Dialog.Body>
          <Dialog.Footer>
            <HStack width="full" justify="space-between">
              <ScopeSelector scope={scope} onScopeChange={setScope} />
              <HStack gap={2}>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setIsOpen(false);
                    setViewName("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  colorPalette="blue"
                  onClick={handleConfirm}
                  disabled={!viewName.trim()}
                >
                  Save
                </Button>
              </HStack>
            </HStack>
          </Dialog.Footer>
          <Dialog.CloseTrigger />
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}

/**
 * Dropdown selector for choosing view scope (Project or Myself).
 * Uses a Menu component for simplicity.
 */
function ScopeSelector({
  scope,
  onScopeChange,
}: {
  scope: "project" | "myself";
  onScopeChange: (s: "project" | "myself") => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button variant="outline" size="sm" px={2}>
          {scope === "project" ? <Users size={14} /> : <User size={14} />}
          <Text>{scope === "project" ? "Project" : "Myself"}</Text>
          <ChevronDown size={12} />
        </Button>
      </Menu.Trigger>
      <Menu.Content portalled={false}>
        <Menu.Item value="myself" onClick={() => onScopeChange("myself")}>
          <User size={14} />
          Myself
          {scope === "myself" && <Check size={14} />}
        </Menu.Item>
        <Menu.Item value="project" onClick={() => onScopeChange("project")}>
          <Users size={14} />
          Project
          {scope === "project" && <Check size={14} />}
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}
