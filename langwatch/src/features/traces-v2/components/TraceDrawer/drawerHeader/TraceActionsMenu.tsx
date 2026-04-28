import { Button, Icon } from "@chakra-ui/react";
import { useCallback } from "react";
import { LuDatabase } from "react-icons/lu";
import { Menu } from "~/components/ui/menu";
import { Tooltip } from "~/components/ui/tooltip";
import { useDrawer } from "~/hooks/useDrawer";
import { useConversationTurns } from "../../../hooks/useConversationTurns";

interface TraceActionsMenuProps {
  traceId: string;
  conversationId?: string | null;
}

export function TraceActionsMenu({
  traceId,
  conversationId,
}: TraceActionsMenuProps) {
  const { openDrawer } = useDrawer();

  const conversationTurns = useConversationTurns(
    conversationId ? conversationId : null,
  );
  const conversationTraceIds =
    conversationTurns.data?.items.map((t) => t.traceId) ?? [];
  const hasConversation =
    !!conversationId && conversationTraceIds.length > 1;

  const handleAddTrace = useCallback(() => {
    openDrawer("addDatasetRecord", { traceId });
  }, [openDrawer, traceId]);

  const handleAddConversation = useCallback(() => {
    openDrawer("addDatasetRecord", { selectedTraceIds: conversationTraceIds });
  }, [openDrawer, conversationTraceIds]);

  if (!hasConversation) {
    return (
      <Tooltip content="Add to dataset" positioning={{ placement: "bottom" }}>
        <Button
          size="xs"
          variant="ghost"
          onClick={handleAddTrace}
          aria-label="Add to dataset"
        >
          <Icon as={LuDatabase} boxSize={3.5} />
        </Button>
      </Tooltip>
    );
  }

  return (
    <Menu.Root>
      <Tooltip content="Add to dataset" positioning={{ placement: "bottom" }}>
        <Menu.Trigger asChild>
          <Button size="xs" variant="ghost" aria-label="Add to dataset">
            <Icon as={LuDatabase} boxSize={3.5} />
          </Button>
        </Menu.Trigger>
      </Tooltip>
      <Menu.Content minWidth="220px">
        <Menu.Item value="trace" onClick={handleAddTrace}>
          Add this trace to dataset
        </Menu.Item>
        <Menu.Item value="conversation" onClick={handleAddConversation}>
          Add full conversation to dataset
          <Menu.ItemCommand>
            {conversationTraceIds.length} turns
          </Menu.ItemCommand>
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}
