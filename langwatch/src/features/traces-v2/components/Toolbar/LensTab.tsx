import { Badge, Box, Input, Tabs } from "@chakra-ui/react";
import { useState } from "react";
import type React from "react";
import {
  LuCopy,
  LuPencil,
  LuSave,
  LuTrash2,
  LuUndo2,
} from "react-icons/lu";
import {
  MenuContent,
  MenuContextTrigger,
  MenuItem,
  MenuRoot,
  MenuSeparator,
} from "../../../../components/ui/menu";
import { Tooltip } from "~/components/ui/tooltip";
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
  const duplicateLens = useViewStore((s) => s.duplicateLens);
  const deleteLens = useViewStore((s) => s.deleteLens);
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
          <Box
            as="span"
            color={lens.isBuiltIn ? "fg.muted" : undefined}
          >
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
    backgroundColor="blue.500"
    display="inline-block"
    marginLeft={0.5}
    flexShrink={0}
  />
);

const ErrorBadge: React.FC<{ count: number }> = ({ count }) => (
  <Badge
    size="xs"
    variant="solid"
    colorPalette="red"
    borderRadius="full"
    marginLeft={1}
  >
    {count}
  </Badge>
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
  const revertLens = useViewStore((s) => s.revertLens);
  const duplicateLens = useViewStore((s) => s.duplicateLens);
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
      <MenuItem value="duplicate" onClick={() => duplicateLens(lensId)}>
        <LuCopy />
        Duplicate to save changes
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
  const saveLens = useViewStore((s) => s.saveLens);
  const revertLens = useViewStore((s) => s.revertLens);
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
