// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The connection's name, and the one control that changes it. A NAME, NOT AN
 * IDENTIFIER: a sign-in reaches this connection by its connection id, so two
 * organizations can both call theirs `okta` and nothing routes on this
 * string. Edited in place — a whole screen for one word is furniture.
 */
import { HStack, IconButton, Input, Text } from "@chakra-ui/react";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Check, Pencil, X } from "lucide-react";
import { useState } from "react";

export function ConnectionNameRow({
  name,
  canManage,
  renaming = false,
  onRename,
}: {
  name: string;
  canManage: boolean;
  renaming?: boolean;
  onRename: (command: { name: string }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  if (!editing) {
    return (
      <HStack gap={1} minWidth={0}>
        <Text fontSize="sm" data-testid="connection-name">
          {name}
        </Text>
        {canManage && (
          <Tooltip content="Rename this connection">
            <IconButton
              aria-label="Rename this connection"
              size="xs"
              variant="ghost"
              onClick={() => {
                setDraft(name);
                setEditing(true);
              }}
              data-testid="connection-name-edit"
            >
              <Pencil size={12} />
            </IconButton>
          </Tooltip>
        )}
      </HStack>
    );
  }

  // Empty is the one refusal worth making here rather than at the server: a
  // blank name leaves the card with nothing on it, and the person can see
  // that as they type.
  const submittable = draft.trim().length > 0 && !renaming;
  const save = () => {
    if (!submittable) return;
    setEditing(false);
    onRename({ name: draft.trim() });
  };

  return (
    <HStack gap={1} minWidth={0}>
      <Input
        size="xs"
        width="180px"
        value={draft}
        aria-label="Connection name"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") save();
          if (event.key === "Escape") setEditing(false);
        }}
        data-testid="connection-name-input"
      />
      <IconButton
        aria-label="Save the name"
        size="xs"
        variant="ghost"
        disabled={!submittable}
        loading={renaming}
        onClick={save}
        data-testid="connection-name-save"
      >
        <Check size={12} />
      </IconButton>
      <IconButton
        aria-label="Keep the current name"
        size="xs"
        variant="ghost"
        onClick={() => setEditing(false)}
        data-testid="connection-name-cancel"
      >
        <X size={12} />
      </IconButton>
    </HStack>
  );
}
