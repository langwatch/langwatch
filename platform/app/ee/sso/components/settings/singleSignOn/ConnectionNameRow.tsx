import { HStack, IconButton, Input, Text } from "@chakra-ui/react";
import { Check, Pencil, X } from "lucide-react";
import { useState } from "react";
import { Tooltip } from "~/components/ui/tooltip";
import { api } from "~/utils/api";
import { reportRefusal } from "./refusals";

/**
 * The connection's name, and the one control that changes it.
 *
 * A NAME, NOT AN IDENTIFIER, and the engine already knew: a sign-in reaches
 * this connection by its CONNECTION ID — deliberately, so two organizations
 * can both call theirs `okta` — so nothing routes on this string and no saved
 * link breaks when it changes. It was only ever called `providerId` because
 * registration collected it under that name, and reading "identity provider:
 * lw" next to an unchangeable value made it look like a key somebody had
 * better not touch.
 *
 * EDITED IN PLACE rather than behind a drawer. There is one field, changing
 * it is reversible, and it is the only thing on this card a person is likely
 * to want to correct — a whole screen for one word is furniture.
 */
export function ConnectionNameRow({
  organizationId,
  connectionId,
  name,
  canManage,
}: {
  organizationId: string;
  connectionId: string;
  name: string;
  canManage: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const utils = api.useUtils();
  const rename = api.ssoSetup.rename.useMutation();

  const settle = () => {
    setEditing(false);
    void utils.ssoSetup.getSetup.invalidate();
    // The rename is a fact on the connection's own sequence, so the history
    // beside it is stale the moment this lands.
    void utils.ssoSetup.getHistory.invalidate({ organizationId, connectionId });
  };

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
  const submittable = draft.trim().length > 0 && !rename.isPending;
  const save = () => {
    if (!submittable) return;
    rename.mutate(
      { organizationId, connectionId, name: draft.trim() },
      { onSuccess: settle, onError: reportRefusal },
    );
  };

  return (
    <HStack gap={1} minWidth={0}>
      <Input
        size="xs"
        width="180px"
        value={draft}
        autoFocus
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
        loading={rename.isPending}
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
