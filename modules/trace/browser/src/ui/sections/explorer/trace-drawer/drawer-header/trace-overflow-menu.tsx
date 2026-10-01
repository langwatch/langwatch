import { useDrawer } from "@langwatch/browser-host/use-drawer";
import { Menu } from "@langwatch/design-system/menu";
import { Button, HStack, Icon, Text } from "@langwatch/design-system/primitives";
import { toaster } from "@langwatch/design-system/toaster";
import { MoreVertical } from "lucide-react";
import { useCallback, useMemo } from "react";
import {
  LuBraces,
  LuCopy,
  LuDatabase,
  LuExternalLink,
  LuKeyboard,
  LuListPlus,
  LuLock,
  LuLockOpen,
  LuMessagesSquare,
  LuPencil,
  LuPin,
  LuPinOff,
  LuScanSearch,
} from "react-icons/lu";

import { useOrganizationTeamProject } from "../../../../../behavior/use-organization-team-project.ts";
import {
  usePinTrace,
  useTracePinRead,
  useUnpinTrace,
} from "../../../../../behavior/writes/use-trace-writes.ts";
import { isPreviewTraceId } from "../../../../../model/preview-trace-id.ts";
import { showErrorToast } from "../../../errors/index.ts";
import { useConversationTurns } from "../../hooks/use-conversation-turns.ts";
import { enterTraceEditMode } from "../../utils/trace-edit-mode.ts";

interface TraceOverflowMenuProps {
  traceId: string;
  conversationId: string | null;
  onCopyTraceId: () => void;
  onFindSimilar: (() => void) | null;
  dejaViewHref: string | null;
  onOpenRawJson: () => void;
  onShowShortcuts: () => void;
  /** Sends this trace to a person or an annotation queue. Dialog owned by the header. */
  onAddToAnnotationQueue: () => void;
  /** Current dock state. When true the drawer stays open on outside clicks. */
  pinned: boolean;
  onTogglePinned: () => void;
  /**
   * Public share view. Correcting a trace is authenticated review work, so the
   * action is absent rather than shown and refused.
   */
  readOnly?: boolean;
}

/**
 * The trace's pin. Pins are UI annotations and do not exempt rows from the TTL.
 * A share's own pin belongs to the share, so it cannot be unpinned by hand
 * while the share is live, and the menu says so rather than failing.
 */
function useTracePin({ projectId, traceId }: { projectId: string | undefined; traceId: string }) {
  const pinQuery = useTracePinRead({ projectId, traceId });
  const isPinned = !!pinQuery.data;
  const isSharePin = pinQuery.data?.source === "share";
  const pinMutation = usePinTrace();
  const unpinMutation = useUnpinTrace();
  const toggle = () => {
    if (!projectId) return;
    const verb = isPinned ? "unpin" : "pin";
    (isPinned ? unpinMutation : pinMutation).mutate(
      { projectId, traceId },
      {
        onSuccess: () => toaster.create({ title: `Trace ${verb}ned`, type: "success" }),
        onError: (error) => showErrorToast({ error, fallbackTitle: `Couldn't ${verb} trace` }),
      },
    );
  };
  const ownLabel = isPinned ? "Unpin trace" : "Pin trace";
  return {
    isPinned,
    isSharePin,
    label: isSharePin ? "Pinned by share" : ownLabel,
    isBusy: pinMutation.isPending || unpinMutation.isPending,
    toggle,
  };
}

/**
 * Single overflow menu that absorbs every secondary drawer action so the top-right
 * action cluster stays small (Share / Refresh / Maximize / More / Close).
 */
export function TraceOverflowMenu({
  traceId,
  conversationId,
  onCopyTraceId,
  onFindSimilar,
  dejaViewHref,
  onOpenRawJson,
  onShowShortcuts,
  onAddToAnnotationQueue,
  pinned,
  onTogglePinned,
  readOnly = false,
}: TraceOverflowMenuProps) {
  const { openDrawer } = useDrawer();
  const { project, hasPermission } = useOrganizationTeamProject();
  // Queueing a trace for annotation is the same authenticated review work the
  // correction is, so the share view leaves it out rather than relying on the
  // reader happening to hold no permission on the project.
  const canQueueForAnnotation = !readOnly && hasPermission("annotations:create");
  // Annotating a trace is review work, which is the permission external
  // reviewers hold, and it is the same one the correction write itself checks.
  // A sample preview trace is left out: it exists only to show an empty project
  // what a trace looks like, so a pass over one could never be saved.
  const canEditTrace =
    !readOnly && !isPreviewTraceId(traceId) && hasPermission("annotations:update");

  const handleEditTrace = useCallback(() => enterTraceEditMode(traceId), [traceId]);

  const pin = useTracePin({ projectId: project?.id, traceId });

  const conversationTurns = useConversationTurns(conversationId);
  const conversationTraceIds = useMemo(
    () => conversationTurns.data?.items.map((t) => t.traceId) ?? [],
    [conversationTurns.data],
  );
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

  return (
    <Menu.Root positioning={{ placement: "bottom-end" }}>
      <Menu.Trigger asChild>
        <Button
          size="xs"
          variant="ghost"
          aria-label="More actions"
          data-testid="trace-overflow-menu"
        >
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

        {canQueueForAnnotation && (
          <Menu.Item
            value="add-to-annotation-queue"
            onClick={onAddToAnnotationQueue}
            data-testid="trace-overflow-add-to-annotation-queue"
          >
            <HStack gap={2}>
              <Icon as={LuListPlus} boxSize={3.5} />
              <Text>Add to annotation queue</Text>
            </HStack>
          </Menu.Item>
        )}

        {canEditTrace && (
          <Menu.Item value="edit-trace" onClick={handleEditTrace}>
            <HStack gap={2}>
              <Icon as={LuPencil} boxSize={3.5} />
              <Text>Edit trace</Text>
            </HStack>
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

        {project && (
          <Menu.Item value="pin" onClick={pin.toggle} disabled={pin.isBusy || pin.isSharePin}>
            <HStack gap={2}>
              <Icon as={pin.isPinned ? LuPinOff : LuPin} boxSize={3.5} />
              <Text>{pin.label}</Text>
            </HStack>
          </Menu.Item>
        )}

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
      </Menu.Content>
    </Menu.Root>
  );
}
