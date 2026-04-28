import { Box, Input, Tabs } from "@chakra-ui/react";
import type React from "react";
import { useState } from "react";
import {
  LuCopy,
  LuFilePlus,
  LuPencil,
  LuSave,
  LuTrash2,
  LuUndo2,
} from "react-icons/lu";
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

interface LensTabProps {
  lens: LensConfig;
  isDraft: boolean;
  errorCount: number;
}

export const LensTab: React.FC<LensTabProps> = ({
  lens,
  isDraft,
  errorCount,
}) => {
  const renameLens = useViewStore((s) => s.renameLens);
  const canDelete = useViewStore((s) => s.allLenses.length > 1);

  const [isRenaming, setIsRenaming] = useState(false);

  const handleRename = (next: string) => {
    const trimmed = next.trim();
    if (trimmed && trimmed !== lens.name) renameLens(lens.id, trimmed);
    setIsRenaming(false);
  };

  const trigger = (
    <Tabs.Trigger value={lens.id} paddingX={2} minWidth="auto" gap={1}>
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
      {isDraft && <DraftDot />}
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
      content="Built-in lens — duplicate to customise, right-click for options"
      positioning={{ placement: "bottom" }}
    >
      {children}
    </Tooltip>
  );
};

const DraftDot: React.FC = () => (
  <Box
    as="span"
    width="6px"
    height="6px"
    borderRadius="full"
    backgroundColor="orange.solid"
    display="inline-block"
    marginLeft={0.5}
    flexShrink={0}
  />
);

const ErrorBadge: React.FC<{ count: number }> = ({ count }) => (
  <Box
    as="span"
    display="inline-flex"
    alignItems="center"
    gap={1}
    marginLeft={1.5}
    paddingX={1.5}
    paddingY="1px"
    borderRadius="full"
    bg="red.subtle"
    color="red.fg"
    borderWidth="1px"
    borderColor="red.muted"
    fontSize="2xs"
    fontWeight="semibold"
    lineHeight="1"
    minWidth="18px"
    height="16px"
    justifyContent="center"
    fontVariantNumeric="tabular-nums"
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

/**
 * Prompt the user for a new lens name and call `saveAsNewLens` with the
 * trimmed result. Uses `window.prompt` for now — it sidesteps the awkward
 * "popover-from-context-menu" interaction and matches the bar of effort the
 * existing rename flow sets. Replace with a proper inline input later if
 * we want to polish it.
 */
function promptSaveAsNewLens(
  defaultName: string,
  saveAsNewLens: (name: string) => string,
): void {
  if (typeof window === "undefined") return;
  const name = window.prompt("Save as new lens — name:", defaultName);
  if (!name) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  saveAsNewLens(trimmed);
}

const BuiltInLensMenuItems: React.FC<{
  lensId: string;
  canDelete: boolean;
}> = ({ lensId, canDelete }) => {
  const isDraft = useViewStore((s) => s.isDraft(lensId));
  const lensName = useViewStore(
    (s) => s.allLenses.find((l) => l.id === lensId)?.name ?? "",
  );
  const revertLens = useViewStore((s) => s.revertLens);
  const saveAsNewLens = useViewStore((s) => s.saveAsNewLens);
  const deleteLens = useViewStore((s) => s.deleteLens);

  return (
    <>
      <MenuItem
        value="revert"
        onClick={() => revertLens(lensId)}
        disabled={!isDraft}
      >
        <LuUndo2 />
        Revert
      </MenuItem>
      <MenuItem
        value="save-as-new"
        onClick={() => promptSaveAsNewLens(`${lensName} (copy)`, saveAsNewLens)}
      >
        <LuFilePlus />
        Save as new lens
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        value="delete"
        onClick={() => deleteLens(lensId)}
        disabled={!canDelete}
        color="fg.error"
      >
        <LuTrash2 />
        Delete
      </MenuItem>
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
  const saveLens = useViewStore((s) => s.saveLens);
  const revertLens = useViewStore((s) => s.revertLens);
  const saveAsNewLens = useViewStore((s) => s.saveAsNewLens);
  const duplicateLens = useViewStore((s) => s.duplicateLens);
  const deleteLens = useViewStore((s) => s.deleteLens);

  return (
    <>
      <MenuItem
        value="save"
        onClick={() => saveLens(lensId)}
        disabled={!isDraft}
      >
        <LuSave />
        Save
      </MenuItem>
      <MenuItem
        value="revert"
        onClick={() => revertLens(lensId)}
        disabled={!isDraft}
      >
        <LuUndo2 />
        Revert
      </MenuItem>
      <MenuSeparator />
      <MenuItem value="rename" onClick={onRename}>
        <LuPencil />
        Rename
      </MenuItem>
      <MenuItem
        value="save-as-new"
        onClick={() => promptSaveAsNewLens(`${lensName} (copy)`, saveAsNewLens)}
      >
        <LuFilePlus />
        Save as new lens
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
    </>
  );
};
