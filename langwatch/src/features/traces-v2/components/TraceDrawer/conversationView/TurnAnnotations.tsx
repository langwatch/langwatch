import { Avatar, Box, Button, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { Database, Edit3, Lightbulb, MessageSquare } from "lucide-react";
import { forwardRef, useState } from "react";
import { Popover } from "~/components/ui/popover";
import { Tooltip } from "~/components/ui/tooltip";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { AnnotationPopover } from "./AnnotationPopover";

interface TurnAnnotationProps {
  traceId: string;
  /** The current output for this turn — pre-filled into the suggest form. */
  output?: string | null;
}

/**
 * Inline action row that sits in each turn separator. Each action button is
 * its own popover trigger — clicking opens the form anchored to that button
 * rather than dropping a heavy panel into the conversation flow.
 */
export function TurnActionRow({ traceId, output }: TurnAnnotationProps) {
  const { hasPermission } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();
  const [openPopover, setOpenPopover] = useState<"annotate" | "suggest" | null>(
    null,
  );

  const canManage = hasPermission("annotations:manage");

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  if (!canManage) return null;

  return (
    <HStack
      gap={0.5}
      flexShrink={0}
      flexWrap="wrap"
      justify="flex-end"
      onClick={stop}
    >
      <AnnotationPopover
        traceId={traceId}
        output={output}
        mode="annotate"
        open={openPopover === "annotate"}
        onOpenChange={(open) => setOpenPopover(open ? "annotate" : null)}
        trigger={
          <ActionButton
            icon={Edit3}
            label="Annotate"
            tooltip="Add a note or score"
          />
        }
      />
      <AnnotationPopover
        traceId={traceId}
        output={output}
        mode="suggest"
        open={openPopover === "suggest"}
        onOpenChange={(open) => setOpenPopover(open ? "suggest" : null)}
        trigger={
          <ActionButton
            icon={Lightbulb}
            label="Suggest"
            tooltip="Suggest a corrected output"
          />
        }
      />
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
          onClick={(e) => {
            e.stopPropagation();
            openDrawer("addDatasetRecord", { traceId });
          }}
        >
          <Icon as={Database} boxSize={3} />
          <Text textStyle="2xs">Dataset</Text>
        </Button>
      </Tooltip>
    </HStack>
  );
}

const ActionButton = forwardRef<
  HTMLButtonElement,
  {
    icon: typeof Edit3;
    label: string;
    tooltip: string;
  } & React.ComponentProps<typeof Button>
>(function ActionButton({ icon, label, tooltip, ...buttonProps }, ref) {
  return (
    <Tooltip content={tooltip} positioning={{ placement: "top" }}>
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
    </Tooltip>
  );
});


interface TurnAnnotationBadgesProps {
  traceId: string;
  output?: string | null;
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
}: TurnAnnotationBadgesProps) {
  const { project, hasPermission } = useOrganizationTeamProject();
  const [listOpen, setListOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const annotations = api.annotation.getByTraceId.useQuery(
    { projectId: project?.id ?? "", traceId },
    { enabled: !!project?.id && hasPermission("annotations:view") },
  );

  const items = annotations.data ?? [];
  const annotationCount = items.length;
  const hasCorrection = items.some((a) => a.expectedOutput);
  const canEdit = hasPermission("annotations:manage");

  if (annotationCount === 0) return null;

  return (
    <>
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
                <Box
                  key={a.id}
                  role={canEdit ? "button" : undefined}
                  tabIndex={canEdit ? 0 : undefined}
                  onClick={
                    canEdit
                      ? (e: React.MouseEvent) => {
                          e.stopPropagation();
                          setListOpen(false);
                          setEditingId(a.id);
                        }
                      : undefined
                  }
                  cursor={canEdit ? "pointer" : "default"}
                  textAlign="left"
                  paddingX={2}
                  paddingY={1.5}
                  borderRadius="sm"
                  _hover={canEdit ? { bg: "bg.muted" } : undefined}
                >
                  <HStack gap={2} align="start">
                    <Avatar.Root size="xs" background="gray.solid" color="white">
                      <Avatar.Fallback
                        name={a.user?.name ?? a.email ?? "?"}
                      />
                    </Avatar.Root>
                    <VStack align="start" gap={0} flex={1} minWidth={0}>
                      <HStack gap={1.5} width="full">
                        <Text textStyle="2xs" fontWeight="600">
                          {a.user?.name ?? a.email ?? "anonymous"}
                        </Text>
                        {a.expectedOutput && (
                          <Icon
                            as={Lightbulb}
                            boxSize={2.5}
                            color="yellow.fg"
                          />
                        )}
                        <Box flex={1} />
                        <Text textStyle="2xs" color="fg.subtle">
                          {new Date(a.createdAt).toLocaleDateString()}
                        </Text>
                      </HStack>
                      {a.comment && (
                        <Text textStyle="2xs" color="fg.muted" lineClamp={3}>
                          {a.comment}
                        </Text>
                      )}
                    </VStack>
                  </HStack>
                </Box>
              ))}
            </VStack>
          </Popover.Body>
        </Popover.Content>
      </Popover.Root>

      {/* Hidden second popover that re-opens for edit. We need a separate
          AnnotationPopover so opening it doesn't fight the badge popover's
          state, and we anchor it with a hidden span next to the badge. */}
      {canEdit && editingId && (
        <AnnotationPopover
          traceId={traceId}
          output={output}
          mode={
            items.find((a) => a.id === editingId)?.expectedOutput
              ? "suggest"
              : "annotate"
          }
          annotationId={editingId}
          open={!!editingId}
          onOpenChange={(o) => {
            if (!o) setEditingId(null);
          }}
          trigger={
            <Box
              as="span"
              aria-hidden="true"
              display="inline-block"
              width="0"
              height="0"
            />
          }
        />
      )}
    </>
  );
}
