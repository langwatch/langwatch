import {
  Box,
  Button,
  HStack,
  Input,
  Stack,
  Tabs,
  Text,
} from "@chakra-ui/react";
import type React from "react";
import { useState } from "react";
import {
  LuCopy,
  LuFilePlus,
  LuPencil,
  LuTrash2,
  LuUndo2,
} from "react-icons/lu";
import {
  PopoverBody,
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "~/components/ui/popover";
import { Tooltip } from "~/components/ui/tooltip";
import {
  MenuContent,
  MenuContextTrigger,
  MenuItem,
  MenuRoot,
  MenuSeparator,
} from "../../../../components/ui/menu";
import type { LensConfig } from "../../stores/viewStore";
import { useViewStore } from "../../stores/viewStore";
import { LensNameDialog } from "./LensNameDialog";

interface LensTabProps {
  lens: LensConfig;
  isDraft: boolean;
  errorCount: number;
  /**
   * When true the tab still mounts (so its `data-value` lives in the DOM
   * and the overflow measurement loop can keep tracking lens identity)
   * but is laid out with `display: none` so it occupies no space and
   * isn't visible. The overflow menu surfaces these instead.
   */
  hidden?: boolean;
}

export const LensTab: React.FC<LensTabProps> = ({
  lens,
  isDraft,
  errorCount,
  hidden,
}) => {
  const renameLens = useViewStore((s) => s.renameLens);
  const revertLens = useViewStore((s) => s.revertLens);
  const canDelete = useViewStore((s) => s.allLenses.length > 1);

  const [isRenaming, setIsRenaming] = useState(false);

  const handleRename = (next: string) => {
    const trimmed = next.trim();
    if (trimmed && trimmed !== lens.name) renameLens(lens.id, trimmed);
    setIsRenaming(false);
  };

  // Double-click is a fast "snap back to the saved lens" — clears the local
  // draft for this lens only. No-op for clean lenses so the gesture is
  // predictable. Lenses are immutable from the user's perspective: drafts
  // are local-only, double-click discards them.
  const handleDoubleClick = (e: React.MouseEvent) => {
    if (!isDraft) return;
    e.preventDefault();
    e.stopPropagation();
    revertLens(lens.id);
  };

  // Build the screen-reader label up front so the badge count reads
  // separated from the lens name. Without an explicit aria-label the
  // browser concatenates the inner text ("Errors" + the badge's "5")
  // into a single string "Errors5" — fine visually because the badge
  // is offset with margin, broken for screen readers and any DOM-text
  // consumer (test assertions, analytics).
  const ariaLabel =
    errorCount > 0
      ? `${lens.name}, ${errorCount} error${errorCount === 1 ? "" : "s"}`
      : undefined;

  const trigger = (
    <Tabs.Trigger
      value={lens.id}
      paddingX={2}
      minWidth="auto"
      gap={1}
      aria-label={ariaLabel}
      display={hidden ? "none" : undefined}
      onDoubleClick={handleDoubleClick}
    >
      {isRenaming ? (
        <RenameInput
          initialValue={lens.name}
          onCommit={handleRename}
          onCancel={() => setIsRenaming(false)}
        />
      ) : (
        <BuiltInTooltip enabled={lens.isBuiltIn}>
          {/* Built-in lenses dim their label instead of carrying a
              sparkles badge — saves horizontal space and the muted colour
              already telegraphs "this one's structural, you can't edit it". */}
          <Box as="span" color={lens.isBuiltIn ? "fg.muted" : undefined}>
            {lens.name}
          </Box>
        </BuiltInTooltip>
      )}
      {isDraft && <DraftDot lensId={lens.id} lensName={lens.name} />}
      {errorCount > 0 && <ErrorBadge count={errorCount} />}
    </Tabs.Trigger>
  );

  return (
    <MenuRoot>
      <MenuContextTrigger asChild>{trigger}</MenuContextTrigger>
      <MenuContent minWidth="160px">
        {lens.isBuiltIn ? (
          <BuiltInLensMenuItems lensId={lens.id} canDelete={canDelete} />
        ) : (
          <UserLensMenuItems
            lensId={lens.id}
            isDraft={isDraft}
            onRename={() => setIsRenaming(true)}
          />
        )}
      </MenuContent>
    </MenuRoot>
  );
};

interface BuiltInTooltipProps {
  enabled: boolean;
  children: React.ReactNode;
}

const BuiltInTooltip: React.FC<BuiltInTooltipProps> = ({
  enabled,
  children,
}) => {
  if (!enabled) return <>{children}</>;
  return (
    <Tooltip
      content="Built-in lens. Duplicate to customise, right-click for options."
      positioning={{ placement: "bottom" }}
    >
      {children}
    </Tooltip>
  );
};

/**
 * Orange dot marking a lens with unsaved local edits. Clicking the dot
 * opens a popover explaining "changes made" and offering Discard /
 * Save as new lens. Replaces the previous bare dot — which carried the
 * signal but no affordance, leaving users guessing what it meant or
 * how to resolve it.
 */
const DraftDot: React.FC<{ lensId: string; lensName: string }> = ({
  lensId,
  lensName,
}) => {
  const revertLens = useViewStore((s) => s.revertLens);
  const createLens = useViewStore((s) => s.createLens);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);

  return (
    <>
      <Tooltip
        content="Unsaved changes. Click to discard or save as new lens."
        positioning={{ placement: "bottom" }}
      >
        <Box display="inline-flex" marginLeft={0.5}>
          <PopoverRoot
            open={popoverOpen}
            onOpenChange={(e) => setPopoverOpen(e.open)}
            positioning={{ placement: "bottom" }}
          >
            <PopoverTrigger asChild>
              <Box
                // A span, not a button: this dot lives inside the lens
                // Tabs.Trigger, which is itself a <button>, and a <button>
                // nested in a <button> is invalid HTML (hydration error).
                // role/tabIndex/onKeyDown restore the button keyboard
                // semantics on the span.
                as="span"
                role="button"
                tabIndex={0}
                // Bumped 6px → 8px + ring. Original was easy to miss
                // (especially against busy backgrounds), and missing it
                // meant a stale draft filter loaded from localStorage
                // could silently scope the table to a previous session's
                // query without the user realising. The ring gives the
                // dot some "halo" so it pops at a glance.
                width="8px"
                height="8px"
                borderRadius="full"
                backgroundColor="orange.solid"
                // Layered halo: a crisp `.subtle` inner ring plus a softer
                // `.muted` outer glow so the unsaved-draft dot draws the eye
                // amid the lens strip without the hard single-ring outline
                // reading as a focus state. Both layers use orange semantic
                // tokens (the lens / draft hue) — no raw colour (T17).
                boxShadow="0 0 0 2px var(--chakra-colors-orange-subtle), 0 0 5px 1px var(--chakra-colors-orange-muted)"
                display="inline-block"
                flexShrink={0}
                cursor="pointer"
                aria-label="Unsaved changes on this lens. Click for options."
                onClick={(e) => {
                  e.stopPropagation();
                  setPopoverOpen((v) => !v);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    setPopoverOpen((v) => !v);
                  }
                }}
              />
            </PopoverTrigger>
            <PopoverContent width="280px">
              <PopoverBody>
                <Stack gap={3}>
                  <Text textStyle="sm" color="fg.muted" lineHeight="1.4">
                    You've changed columns, filters or sort on{" "}
                    <Text as="span" color="fg" fontWeight="semibold">
                      {lensName}
                    </Text>
                    . These edits live in your browser only. Save them as a new
                    lens to keep them, or discard to snap back.
                  </Text>
                  <HStack gap={2} justify="flex-end">
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        revertLens(lensId);
                        setPopoverOpen(false);
                      }}
                    >
                      Discard changes
                    </Button>
                    <Button
                      size="xs"
                      colorPalette="orange"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPopoverOpen(false);
                        setSaveDialogOpen(true);
                      }}
                    >
                      Save as new lens
                    </Button>
                  </HStack>
                </Stack>
              </PopoverBody>
            </PopoverContent>
          </PopoverRoot>
        </Box>
      </Tooltip>
      <LensNameDialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        title="Save changes as new lens"
        defaultName={`${lensName} (copy)`}
        onSubmit={(name) => createLens(name)}
      />
    </>
  );
};

const ErrorBadge: React.FC<{ count: number }> = ({ count }) => (
  // The lens-tab error count is the only aggregate "how bad is it right now"
  // signal on the trace explorer — every other surface (row tint, in-drawer
  // exception accordion) is per-trace. It needs to read at a glance from
  // across the room, so it's the only place we use a `solid` red badge
  // instead of the subtle/muted treatment the rest of the tabs use. The
  // count is bound to the user's currently-selected time range so it
  // matches the window every other panel is querying.
  <Box
    as="span"
    display="inline-flex"
    alignItems="center"
    gap={1}
    marginLeft={1.5}
    paddingX={1.5}
    paddingY="1px"
    borderRadius="full"
    bg="red.solid"
    color="red.contrast"
    fontSize="xs"
    fontWeight="bold"
    lineHeight="1"
    minWidth="20px"
    height="18px"
    justifyContent="center"
    fontVariantNumeric="tabular-nums"
    boxShadow="0 1px 2px rgba(220,38,38,0.25)"
  >
    {count > 99 ? "99+" : count}
  </Box>
);

const RenameInput: React.FC<{
  initialValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}> = ({ initialValue, onCommit, onCancel }) => {
  const [value, setValue] = useState(initialValue);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") onCommit(value);
    else if (e.key === "Escape") onCancel();
  };

  return (
    <Input
      autoFocus
      size="xs"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={handleKeyDown}
      onClick={(e) => e.stopPropagation()}
      width="80px"
      paddingX={1}
      paddingY={0}
      height="20px"
    />
  );
};

const BuiltInLensMenuItems: React.FC<{
  lensId: string;
  canDelete: boolean;
}> = ({ lensId, canDelete }) => {
  const isDraft = useViewStore((s) => s.isDraft(lensId));
  const lensName = useViewStore(
    (s) => s.allLenses.find((l) => l.id === lensId)?.name ?? "",
  );
  const revertLens = useViewStore((s) => s.revertLens);
  const createLens = useViewStore((s) => s.createLens);
  const deleteLens = useViewStore((s) => s.deleteLens);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);

  // "All" is the table's home base — if a user could dismiss it
  // they'd lose the "show me everything" entry point with no way back
  // short of clearing localStorage. Lock it as undeletable. Other
  // built-ins (Conversations, Errors, …) can still be hidden via the
  // `dismissedBuiltInIds` set so power users keep a clean strip.
  const isUndeletable = lensId === "all-traces";

  return (
    <>
      <MenuItem
        value="save-as-new"
        onClick={() => setSaveDialogOpen(true)}
        fontWeight={isDraft ? "semibold" : undefined}
      >
        <LuFilePlus />
        {isDraft ? "Save changes as new lens…" : "Save as new lens…"}
      </MenuItem>
      <MenuItem
        value="revert"
        onClick={() => revertLens(lensId)}
        disabled={!isDraft}
      >
        <LuUndo2 />
        Revert local changes
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        value="delete"
        onClick={() => !isUndeletable && canDelete && deleteLens(lensId)}
        disabled={isUndeletable || !canDelete}
        color="fg.error"
      >
        <LuTrash2 />
        Delete
      </MenuItem>
      <LensNameDialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        title={isDraft ? "Save changes as new lens" : "Save as new lens"}
        defaultName={`${lensName} (copy)`}
        onSubmit={(name) => createLens(name)}
      />
    </>
  );
};

const UserLensMenuItems: React.FC<{
  lensId: string;
  isDraft: boolean;
  onRename: () => void;
}> = ({ lensId, isDraft, onRename }) => {
  const lensName = useViewStore(
    (s) => s.allLenses.find((l) => l.id === lensId)?.name ?? "",
  );
  const revertLens = useViewStore((s) => s.revertLens);
  const createLens = useViewStore((s) => s.createLens);
  const duplicateLens = useViewStore((s) => s.duplicateLens);
  const deleteLens = useViewStore((s) => s.deleteLens);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);

  return (
    <>
      {/* Lenses are immutable — local edits stay local until the user makes
          a copy. The "Save" overwrite was removed because it conflated
          "persist my changes" with "rewrite the shared lens definition". */}
      <MenuItem
        value="save-as-new"
        onClick={() => setSaveDialogOpen(true)}
        fontWeight={isDraft ? "semibold" : undefined}
      >
        <LuFilePlus />
        {isDraft ? "Save changes as new lens…" : "Save as new lens…"}
      </MenuItem>
      <MenuItem
        value="revert"
        onClick={() => revertLens(lensId)}
        disabled={!isDraft}
      >
        <LuUndo2 />
        Revert local changes
      </MenuItem>
      <MenuSeparator />
      <MenuItem value="rename" onClick={onRename}>
        <LuPencil />
        Rename
      </MenuItem>
      <MenuItem value="duplicate" onClick={() => duplicateLens(lensId)}>
        <LuCopy />
        Duplicate
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        value="delete"
        onClick={() => deleteLens(lensId)}
        color="fg.error"
      >
        <LuTrash2 />
        Delete
      </MenuItem>
      <LensNameDialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        title={isDraft ? "Save changes as new lens" : "Save as new lens"}
        defaultName={`${lensName} (copy)`}
        onSubmit={(name) => createLens(name)}
      />
    </>
  );
};
