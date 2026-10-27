/**
 * SaveAsViewButton -- button next to "Filters" heading that opens a dialog to save the current
 * filter state as a named custom view. Rendered by QueryStringFieldsFilters when filters are
 * active; renders nothing where no SavedViewsProvider is mounted (a borrowed sidebar).
 */

import { Dialog } from "@langwatch/design-system/dialog";
import { Menu } from "@langwatch/design-system/menu";
import { Button, Field, Input, Text } from "@langwatch/design-system/primitives";
import { Check, ChevronDown, User, Users } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { useSavedViewsIfMounted } from "../../behavior/use-saved-views.tsx";
import { MAX_VIEW_NAME_LENGTH } from "../../model/saved-views-logic.ts";

export function SaveAsViewButton() {
  const savedViews = useSavedViewsIfMounted();
  const saveView = savedViews?.saveView;
  const [isOpen, setIsOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const [scope, setScope] = useState<"project" | "myself">("project");
  const [attempted, setAttempted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleOpen = useCallback(() => {
    setViewName("");
    setScope("project");
    setAttempted(false);
    setIsOpen(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const handleConfirm = useCallback(() => {
    const trimmed = viewName.trim();
    if (!saveView) return;
    if (!trimmed) {
      setAttempted(true);
      inputRef.current?.focus();
      return;
    }
    saveView(trimmed, scope);
    setIsOpen(false);
    setViewName("");
  }, [viewName, scope, saveView]);

  if (!saveView) return null;

  return (
    <>
      <Button size="xs" variant="outline" onClick={handleOpen} data-testid="save-as-view-button">
        Save as view
      </Button>

      <Dialog
        open={isOpen}
        onClose={() => {
          setIsOpen(false);
          setViewName("");
        }}
        title="Save as view"
        onSubmit={handleConfirm}
        note={<ScopeSelector scope={scope} onScopeChange={setScope} />}
        primaryAction={{ label: "Save", type: "submit" }}
      >
        <Field.Root invalid={attempted && !viewName.trim()}>
          <Input
            ref={inputRef}
            aria-label="View name"
            placeholder="View name..."
            value={viewName}
            onChange={(e) => setViewName(e.target.value.slice(0, MAX_VIEW_NAME_LENGTH))}
            data-testid="save-view-name-input"
          />
          <Field.ErrorText>Enter a view name.</Field.ErrorText>
        </Field.Root>
      </Dialog>
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
