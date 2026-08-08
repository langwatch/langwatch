import { Box, Button, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { createLogger } from "@langwatch/observability";
import {
  Database,
  Edit3,
  Languages,
  Lightbulb,
  MessageSquare,
} from "lucide-react";
import { forwardRef, useState } from "react";
import { PersonalFeatureGateDialog } from "~/components/me/PersonalFeatureGateDialog";
import { usePersonalFeatureGate } from "~/components/me/usePersonalFeatureGate";
import { UserAvatar } from "~/components/UserAvatar";
import { Popover } from "~/components/ui/popover";
import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "~/components/ui/tooltip";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api, type RouterOutputs } from "~/utils/api";
import { useAnnotationDraftStore } from "../../../stores/annotationDraftStore";
import { AnnotationPopover } from "./AnnotationPopover";

type AnnotationItem = RouterOutputs["annotation"]["getByTraceIds"][number];

const logger = createLogger("TurnAnnotations");

interface TurnAnnotationProps {
  traceId: string;
  /** The current output for this turn — pre-filled into the suggest form. */
  output?: string | null;
  /**
   * Per-turn translate-to-English control, owned by the ChatTurnRow so the
   * bubbles can swap text. Rendered here so it sits with the turn's other
   * inline actions — but unlike them it does NOT require annotation
   * permissions (reading a conversation is a viewer activity).
   */
  translation?: {
    isActive: boolean;
    isLoading: boolean;
    onToggle: () => void;
  };
  /**
   * Write annotations in the rail beside the turn rather than in a popover
   * over it. Set by the thread layout, which has a rail; the bubbles layout
   * has none and keeps its popovers.
   */
  shouldUseRailComposer?: boolean;
}

/**
 * Inline action row that sits in each turn separator. Each action button is
 * its own popover trigger — clicking opens the form anchored to that button
 * rather than dropping a heavy panel into the conversation flow.
 */
export function TurnActionRow({
  traceId,
  output,
  translation,
  shouldUseRailComposer = false,
}: TurnAnnotationProps) {
  const { hasPermission } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();
  const openDraft = useAnnotationDraftStore((s) => s.openDraft);
  const [openPopover, setOpenPopover] = useState<"annotate" | "suggest" | null>(
    null,
  );

  const canManage = hasPermission("annotations:manage");

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  const annotationsGate = usePersonalFeatureGate("annotations");
  const datasetsGate = usePersonalFeatureGate("datasets");

  if (!canManage && !translation) return null;

  // The trio used to sit permanently visible on every turn separator —
  // ~180px of chrome multiplied across N turns adds a lot of visual
  // weight to a view that's supposed to be "read the conversation".
  // Default to invisible + reveal on `_groupHover` of the parent
  // ChatTurnRow Flex (which already declares `role="group"`). Forced
  // visible while a popover is open so the anchor doesn't vanish under
  // the user mid-edit — and while a translation is showing/loading so
  // the way back to the original text stays discoverable.
  const isForceVisible =
    openPopover !== null || !!translation?.isActive || !!translation?.isLoading;

  return (
    <HStack
      gap={0.5}
      flexShrink={0}
      flexWrap="wrap"
      justify="flex-end"
      onClick={stop}
      opacity={isForceVisible ? 1 : 0}
      _groupHover={{ opacity: 1 }}
      _groupFocusWithin={{ opacity: 1 }}
      transition="opacity 120ms ease"
    >
      {translation && (
        <Tooltip
          content={
            translation.isActive
              ? "Show the original text"
              : "Translate this turn to English"
          }
          positioning={{ placement: "top" }}
        >
          <Button
            size="2xs"
            variant="ghost"
            color={translation.isActive ? "blue.fg" : "fg.muted"}
            gap={1}
            paddingX={2}
            aria-pressed={translation.isActive}
            disabled={translation.isLoading}
            onClick={(e) => {
              e.stopPropagation();
              translation.onToggle();
            }}
          >
            <Icon as={Languages} boxSize={3} />
            <Text textStyle="2xs">
              {translation.isLoading
                ? "Translating…"
                : translation.isActive
                  ? "Original"
                  : "Translate"}
            </Text>
          </Button>
        </Tooltip>
      )}
      {canManage && (
        <>
          {shouldUseRailComposer ? (
            <>
              <RailComposerButton
                icon={Edit3}
                label="Annotate"
                tooltip="Add a note or score"
                onOpen={async () => {
                  const allowed = await annotationsGate.requestEnable();
                  if (!allowed) return;
                  openDraft({ traceId, mode: "annotate", output });
                }}
              />
              <RailComposerButton
                icon={Lightbulb}
                label="Suggest"
                tooltip="Suggest a corrected output"
                onOpen={async () => {
                  const allowed = await annotationsGate.requestEnable();
                  if (!allowed) return;
                  openDraft({ traceId, mode: "suggest", output });
                }}
              />
            </>
          ) : (
            <>
              <AnnotationPopover
                traceId={traceId}
                output={output}
                mode="annotate"
                open={openPopover === "annotate"}
                onOpenChange={async (open) => {
                  if (open) {
                    const allowed = await annotationsGate.requestEnable();
                    if (!allowed) return;
                  }
                  setOpenPopover(open ? "annotate" : null);
                }}
                triggerTooltip="Add a note or score"
                trigger={<ActionButton icon={Edit3} label="Annotate" />}
              />
              <AnnotationPopover
                traceId={traceId}
                output={output}
                mode="suggest"
                open={openPopover === "suggest"}
                onOpenChange={async (open) => {
                  if (open) {
                    const allowed = await annotationsGate.requestEnable();
                    if (!allowed) return;
                  }
                  setOpenPopover(open ? "suggest" : null);
                }}
                triggerTooltip="Suggest a corrected output"
                trigger={<ActionButton icon={Lightbulb} label="Suggest" />}
              />
            </>
          )}
          <Tooltip
            content="Add this turn to a dataset"
            positioning={{ placement: "top" }}
          >
            <Button
              size="2xs"
              variant="ghost"
              color="fg.muted"
              gap={1}
              paddingX={2}
              onClick={async (e) => {
                e.stopPropagation();
                const allowed = await datasetsGate.requestEnable();
                if (!allowed) return;
                openDrawer("addDatasetRecord", { traceId });
              }}
            >
              <Icon as={Database} boxSize={3} />
              <Text textStyle="2xs">Dataset</Text>
            </Button>
          </Tooltip>
        </>
      )}
      <PersonalFeatureGateDialog state={annotationsGate.dialogState} />
      <PersonalFeatureGateDialog state={datasetsGate.dialogState} />
    </HStack>
  );
}

/**
 * The rail's flavour of an action button: no popover to anchor, it just opens
 * the composer in the column beside the turn.
 */
function RailComposerButton({
  icon,
  label,
  tooltip,
  onOpen,
}: {
  icon: typeof Edit3;
  label: string;
  tooltip: string;
  /** Opening asks the personal-workspace gate first, so it may be async. */
  onOpen: () => void | Promise<void>;
}) {
  return (
    <Tooltip content={tooltip} positioning={{ placement: "top" }}>
      <ActionButton
        icon={icon}
        label={label}
        onClick={(e) => {
          e.stopPropagation();
          void Promise.resolve(onOpen()).catch((error) => {
            logger.error({ error }, "could not open the annotation composer");
            toaster.create({
              title: "Could not open the annotation composer",
              type: "error",
            });
          });
        }}
      />
    </Tooltip>
  );
}

const ActionButton = forwardRef<
  HTMLButtonElement,
  {
    icon: typeof Edit3;
    label: string;
  } & React.ComponentProps<typeof Button>
>(function ActionButton({ icon, label, ...buttonProps }, ref) {
  return (
    <Button
      ref={ref}
      size="2xs"
      variant="ghost"
      color="fg.muted"
      gap={1}
      paddingX={2}
      {...buttonProps}
    >
      <Icon as={icon} boxSize={3} />
      <Text textStyle="2xs">{label}</Text>
    </Button>
  );
});

interface TurnAnnotationBadgesProps {
  traceId: string;
  output?: string | null;
  /**
   * Annotations sourced from the conversation-level `getByTraceIds` query.
   * When provided, this badge skips its own per-trace fetch — avoids N
   * queries for an N-turn conversation.
   */
  prefetchedItems?: AnnotationItem[];
}

/**
 * Compact inline indicators showing this turn already carries an annotation
 * and/or a suggested correction. Clicking the badge pops a small list of
 * who annotated; clicking an entry opens it in the edit popover. Replaces
 * the redundant inline panel that used to live below the bubbles.
 */
export function TurnAnnotationBadges({
  traceId,
  output,
  prefetchedItems,
}: TurnAnnotationBadgesProps) {
  const { project, hasPermission } = useOrganizationTeamProject();
  const [listOpen, setListOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const annotations = api.annotation.getByTraceId.useQuery(
    { projectId: project?.id ?? "", traceId },
    {
      enabled:
        !!project?.id &&
        hasPermission("annotations:view") &&
        prefetchedItems === undefined,
    },
  );

  const items = prefetchedItems ?? annotations.data ?? [];
  const annotationCount = items.length;
  const hasCorrection = items.some((a) => a.expectedOutput);
  const canEdit = hasPermission("annotations:manage");

  if (annotationCount === 0) return null;

  return (
    <Popover.Root
      open={listOpen}
      onOpenChange={(e) => setListOpen(e.open)}
      positioning={{
        placement: "bottom-end",
        flip: true,
        shift: 16,
        overflowPadding: 16,
      }}
    >
      <Popover.Trigger asChild>
        <Button
          variant="ghost"
          size="2xs"
          onClick={(e) => e.stopPropagation()}
          aria-label={`${annotationCount} annotation${
            annotationCount === 1 ? "" : "s"
          } on this turn`}
          flexShrink={0}
          paddingX={1.5}
          paddingY={0.5}
          height="auto"
          borderRadius="sm"
          bg="amber.subtle"
          color="amber.fg"
          _hover={{ bg: "amber.subtle", filter: "brightness(1.1)" }}
          gap={1}
        >
          <Icon as={MessageSquare} boxSize={3} />
          <Text textStyle="2xs" fontWeight="600">
            {annotationCount}
          </Text>
          {hasCorrection && (
            <Icon as={Lightbulb} boxSize={3} color="yellow.fg" />
          )}
        </Button>
      </Popover.Trigger>
      <Popover.Content
        width="320px"
        bg="bg.panel/92"
        onClick={(e) => e.stopPropagation()}
      >
        <Popover.Arrow />
        <Popover.Body padding={1.5}>
          <VStack align="stretch" gap={0.5}>
            {items.map((a) => (
              <AnnotationListRow
                key={a.id}
                annotation={a}
                traceId={traceId}
                output={output}
                canEdit={canEdit}
                isEditing={editingId === a.id}
                onEditingChange={(open) => setEditingId(open ? a.id : null)}
              />
            ))}
          </VStack>
        </Popover.Body>
      </Popover.Content>
    </Popover.Root>
  );
}

/**
 * One annotation in the badge's list, and the way into editing it.
 *
 * For a reviewer who may edit, the line itself is the button that opens the
 * correction popover: it anchors the form where the reviewer was reading, it
 * answers Enter and Space like any button, and closing hands the keyboard back
 * to it. For everyone else it is text.
 */
function AnnotationListRow({
  annotation,
  traceId,
  output,
  canEdit,
  isEditing,
  onEditingChange,
}: {
  annotation: AnnotationItem;
  traceId: string;
  output?: string | null;
  canEdit: boolean;
  isEditing: boolean;
  onEditingChange: (open: boolean) => void;
}) {
  const summary = <AnnotationListRowSummary annotation={annotation} />;

  if (!canEdit) {
    return (
      <Box textAlign="left" paddingX={2} paddingY={1.5} borderRadius="sm">
        {summary}
      </Box>
    );
  }

  return (
    <AnnotationPopover
      traceId={traceId}
      output={output}
      mode={annotation.expectedOutput ? "suggest" : "annotate"}
      annotationId={annotation.id}
      open={isEditing}
      onOpenChange={onEditingChange}
      trigger={
        <Box
          as="button"
          width="full"
          textAlign="left"
          cursor="pointer"
          paddingX={2}
          paddingY={1.5}
          borderRadius="sm"
          _hover={{ bg: "bg.muted" }}
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
        >
          {summary}
        </Box>
      }
    />
  );
}

/** Who left the annotation, when, whether it corrects the turn, and what it says. */
function AnnotationListRowSummary({
  annotation,
}: {
  annotation: AnnotationItem;
}) {
  return (
    <HStack gap={2} align="start">
      <UserAvatar
        size="xs"
        background="gray.solid"
        color="white"
        name={annotation.user?.name ?? annotation.email ?? "?"}
        image={annotation.user?.image}
      />
      <VStack align="start" gap={0} flex={1} minWidth={0}>
        <HStack gap={1.5} width="full">
          <Text textStyle="2xs" fontWeight="600">
            {annotation.user?.name ?? annotation.email ?? "anonymous"}
          </Text>
          {annotation.expectedOutput && (
            <Icon as={Lightbulb} boxSize={2.5} color="yellow.fg" />
          )}
          <Box flex={1} />
          <Text textStyle="2xs" color="fg.subtle">
            {new Date(annotation.createdAt).toLocaleDateString()}
          </Text>
        </HStack>
        {annotation.comment && (
          <Text textStyle="2xs" color="fg.muted" lineClamp={3}>
            {annotation.comment}
          </Text>
        )}
      </VStack>
    </HStack>
  );
}
