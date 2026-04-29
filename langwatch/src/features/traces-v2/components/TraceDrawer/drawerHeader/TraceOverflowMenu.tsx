import { Button, HStack, Icon, Text } from "@chakra-ui/react";
import { useCallback } from "react";
import {
  LuBraces,
  LuCopy,
  LuDatabase,
  LuExternalLink,
  LuKeyboard,
  LuMessagesSquare,
  LuScanSearch,
  LuShare2,
} from "react-icons/lu";
import { MoreVertical } from "lucide-react";
import { Menu } from "~/components/ui/menu";
import { useDrawer } from "~/hooks/useDrawer";
import { useConversationTurns } from "../../../hooks/useConversationTurns";

interface TraceOverflowMenuProps {
  traceId: string;
  conversationId: string | null;
  onCopyTraceId: () => void;
  onFindSimilar: (() => void) | null;
  dejaViewHref: string | null;
  onOpenRawJson: () => void;
  onShowShortcuts: () => void;
}

/**
 * Single overflow menu that absorbs every secondary drawer action so the
 * top-right action cluster stays at four buttons (Refresh / Maximize /
 * More / Close). High-frequency shortcuts (R, M, Esc) keep their dedicated
 * buttons; the rest hide here behind one click.
 */
export function TraceOverflowMenu({
  traceId,
  conversationId,
  onCopyTraceId,
  onFindSimilar,
  dejaViewHref,
  onOpenRawJson,
  onShowShortcuts,
}: TraceOverflowMenuProps) {
  const { openDrawer } = useDrawer();

  const conversationTurns = useConversationTurns(conversationId);
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

  const handleOpenDejaView = useCallback(() => {
    if (!dejaViewHref) return;
    window.open(dejaViewHref, "_blank", "noopener,noreferrer");
  }, [dejaViewHref]);

  return (
    <Menu.Root positioning={{ placement: "bottom-end" }}>
      <Menu.Trigger asChild>
        <Button size="xs" variant="ghost" aria-label="More actions">
          <Icon as={MoreVertical} boxSize={3.5} />
        </Button>
      </Menu.Trigger>
      <Menu.Content minWidth="240px">
        <Menu.Item value="copy" onClick={onCopyTraceId}>
          <HStack gap={2}>
            <Icon as={LuCopy} boxSize={3.5} />
            <Text>Copy trace ID</Text>
          </HStack>
          <Menu.ItemCommand>Y</Menu.ItemCommand>
        </Menu.Item>

        {onFindSimilar && (
          <Menu.Item value="find-similar" onClick={onFindSimilar}>
            <HStack gap={2}>
              <Icon as={LuScanSearch} boxSize={3.5} />
              <Text>Find similar traces</Text>
            </HStack>
          </Menu.Item>
        )}

        <Menu.Separator />

        <Menu.Item value="add-trace" onClick={handleAddTrace}>
          <HStack gap={2}>
            <Icon as={LuDatabase} boxSize={3.5} />
            <Text>Add trace to dataset</Text>
          </HStack>
        </Menu.Item>

        {hasConversation && (
          <Menu.Item value="add-conversation" onClick={handleAddConversation}>
            <HStack gap={2}>
              <Icon as={LuMessagesSquare} boxSize={3.5} />
              <Text>Add conversation to dataset</Text>
            </HStack>
            <Menu.ItemCommand>{conversationTraceIds.length} turns</Menu.ItemCommand>
          </Menu.Item>
        )}

        <Menu.Separator />

        <Menu.Item value="raw-json" onClick={onOpenRawJson}>
          <HStack gap={2}>
            <Icon as={LuBraces} boxSize={3.5} />
            <Text>View raw JSON</Text>
          </HStack>
          <Menu.ItemCommand>\</Menu.ItemCommand>
        </Menu.Item>

        {dejaViewHref && (
          <Menu.Item value="deja-view" onClick={handleOpenDejaView}>
            <HStack gap={2}>
              <Icon as={LuExternalLink} boxSize={3.5} />
              <Text>Open in DejaView</Text>
            </HStack>
          </Menu.Item>
        )}

        <Menu.Item value="share" disabled>
          <HStack gap={2} opacity={0.5}>
            <Icon as={LuShare2} boxSize={3.5} />
            <Text>Share</Text>
          </HStack>
          <Menu.ItemCommand>soon</Menu.ItemCommand>
        </Menu.Item>

        <Menu.Separator />

        <Menu.Item value="shortcuts" onClick={onShowShortcuts}>
          <HStack gap={2}>
            <Icon as={LuKeyboard} boxSize={3.5} />
            <Text>Keyboard shortcuts</Text>
          </HStack>
          <Menu.ItemCommand>?</Menu.ItemCommand>
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}
