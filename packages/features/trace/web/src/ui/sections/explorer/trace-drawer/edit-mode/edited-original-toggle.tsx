import { Button, HStack, Icon, Text } from "@chakra-ui/react";
import { LuGitCompare } from "react-icons/lu";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { useTraceEditOverlay } from "../../hooks/use-trace-edit-overlay";
import type { TraceOverlayView } from "../../../../../index";
import { formatAbsoluteTime, useDrawerStore, useTraceEditStore } from "../../../../../index";
import { SegmentedToggle } from "../../../../elements/explorer/trace-drawer/segmented-toggle";
import { TraceEditDiffDialog } from "../trace-edit-diff-dialog";

const VIEW_OPTIONS = [
  { value: "edited", label: "Edited" },
  { value: "original", label: "Original" },
] as const;

/**
 * Lets the reader switch between the corrected trace and the one that was
 * captured, says who corrected it, and opens the full difference.
 *
 * Renders nothing when the trace has no correction: there would be nothing to
 * switch between, and an inert toggle on every trace is noise. Also absent
 * while editing, when the drawer is showing the correction being written.
 */
export function EditedOriginalToggle() {
  const overlay = useTraceEditOverlay();
  const isEditing = useDrawerStore((s) => s.isEditing);
  const overlayView = useTraceEditStore((s) => s.overlayView);
  const setOverlayView = useTraceEditStore((s) => s.setOverlayView);
  // Shared with the hover on every corrected field, so both reach one dialog.
  const diffOpen = useTraceEditStore((s) => s.diffOpen);
  const setDiffOpen = useTraceEditStore((s) => s.setDiffOpen);

  const correction = overlay.data;
  if (!correction || isEditing) return null;

  const author = correction.updatedBy?.name ?? correction.createdBy?.name;

  return (
    <>
      <HStack gap={2} flexShrink={0}>
        <SegmentedToggle
          value={overlayView}
          onChange={(next) => setOverlayView(next as TraceOverlayView)}
          options={VIEW_OPTIONS}
        />
        {author && (
          <Tooltip
            content={formatAbsoluteTime(new Date(correction.updatedAt).getTime())}
            positioning={{ placement: "bottom" }}
            openDelay={300}
          >
            <Text textStyle="2xs" color="fg.subtle" cursor="help" truncate>
              {`Edited by ${author}`}
            </Text>
          </Tooltip>
        )}
        <Button size="xs" variant="ghost" onClick={() => setDiffOpen(true)} gap={1.5}>
          <Icon as={LuGitCompare} boxSize={3} />
          <Text textStyle="2xs">View diff</Text>
        </Button>
      </HStack>
      <TraceEditDiffDialog
        open={diffOpen}
        onClose={() => setDiffOpen(false)}
        patch={correction.patch}
      />
    </>
  );
}
