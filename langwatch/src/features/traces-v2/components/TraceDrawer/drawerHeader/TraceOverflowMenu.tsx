import { Button, HStack, Icon, Text } from "@chakra-ui/react";
import { MoreVertical } from "lucide-react";
import posthog from "posthog-js";
import { useCallback } from "react";
import {
  LuArrowLeft,
  LuBraces,
  LuCopy,
  LuDatabase,
  LuExternalLink,
  LuKeyboard,
  LuLock,
  LuLockOpen,
  LuMessagesSquare,
  LuScanSearch,
  LuShare2,
} from "react-icons/lu";
import { resetTracesV2PromoSnooze } from "~/components/messages/NewTracesPromo";
import { Menu } from "~/components/ui/menu";
import { useDrawer } from "~/hooks/useDrawer";
import { useConversationTurns } from "../../../hooks/useConversationTurns";
import { setTracesV2Preferred } from "../../../hooks/useTracesV2Preference";

interface TraceOverflowMenuProps {
  traceId: string;
  conversationId: string | null;
  onCopyTraceId: () => void;
  onFindSimilar: (() => void) | null;
  dejaViewHref: string | null;
  onOpenRawJson: () => void;
  onShowShortcuts: () => void;
  /** Current dock state. When true the drawer stays open on outside clicks. */
  pinned: boolean;
  onTogglePinned: () => void;
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
  pinned,
  onTogglePinned,
}: TraceOverflowMenuProps) {
  const { openDrawer } = useDrawer();

  const conversationTurns = useConversationTurns(conversationId);
  const conversationTraceIds =
    conversationTurns.data?.items.map((t) => t.traceId) ?? [];
  const hasConversation = !!conversationId && conversationTraceIds.length > 1;

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

  const handleSwitchBackToV1 = useCallback(() => {
    setTracesV2Preferred(false);
    // Operator just opted out — clear the "Try the new one" snooze
    // so the next legacy-drawer open re-surfaces the promo. Without
    // this, the banner stays hidden for the full 7-day snooze window
    // that the original opt-in click set.
    resetTracesV2PromoSnooze();
    posthog.capture("traces_v2_opt_out", {
      surface: "drawer_overflow_menu",
      traceId,
    });
    // Hard-nav for symmetry with the v1→v2 opt-in (and the same
    // reasoning — soft-swap races against Chakra's unmount-fired
    // onOpenChange). Preserve non-drawer params (`span`, etc.).
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      const drawerKeys: string[] = [];
      url.searchParams.forEach((_, key) => {
        if (key.startsWith("drawer.")) drawerKeys.push(key);
      });
      for (const key of drawerKeys) url.searchParams.delete(key);
      url.searchParams.set("drawer.open", "traceDetails");
      url.searchParams.set("drawer.traceId", traceId);
      url.searchParams.set("drawer.selectedTab", "traceDetails");
      window.location.href = url.toString();
    }
  }, [traceId]);

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
            <Menu.ItemCommand>
              {conversationTraceIds.length} turns
            </Menu.ItemCommand>
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

        {/* Dock / undock lives in the overflow menu so the top-right
            action cluster doesn't grow another low-frequency button.
            Power users still have the button-equivalent in muscle
            memory (the keyboard story is unchanged). */}
        <Menu.Item value="dock" onClick={onTogglePinned}>
          <HStack gap={2}>
            <Icon as={pinned ? LuLock : LuLockOpen} boxSize={3.5} />
            <Text>{pinned ? "Undock drawer" : "Dock drawer"}</Text>
          </HStack>
        </Menu.Item>

        <Menu.Item value="shortcuts" onClick={onShowShortcuts}>
          <HStack gap={2}>
            <Icon as={LuKeyboard} boxSize={3.5} />
            <Text>Keyboard shortcuts</Text>
          </HStack>
          <Menu.ItemCommand>?</Menu.ItemCommand>
        </Menu.Item>

        <Menu.Separator />

        {/* Escape hatch back to the v1 drawer for operators who
            opted into v2 via the promo but want to fall back. Clears
            the localStorage opt-in and re-opens the same trace in
            the legacy drawer — next time they `View Trace` they'll
            land on v1 again until they re-opt in. */}
        <Menu.Item value="switch-back-to-v1" onClick={handleSwitchBackToV1}>
          <HStack gap={2}>
            <Icon as={LuArrowLeft} boxSize={3.5} />
            <Text>Go back to old trace visualization</Text>
          </HStack>
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}
