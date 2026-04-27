import { Badge, Box, HStack, Input, Tabs, Text } from "@chakra-ui/react";
import { useState, useRef, useCallback } from "react";
import type React from "react";
import { LuCopy, LuPencil, LuPlus, LuTrash2, LuUndo2 } from "react-icons/lu";
import { LuSave } from "react-icons/lu";
import {
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "../../../../components/ui/dialog";
import {
  MenuContent,
  MenuContextTrigger,
  MenuItem,
  MenuRoot,
  MenuSeparator,
} from "../../../../components/ui/menu";
import {
  PopoverBody,
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "../../../../components/ui/popover";
import { useViewStore } from "../../stores/viewStore";
import { useErrorCount } from "../../hooks/useErrorCount";
import type { LensConfig } from "../../stores/viewStore";
import { Button } from "@chakra-ui/react";

export const LensTabs: React.FC = () => {
  const activeLensId = useViewStore((s) => s.activeLensId);
  const allLenses = useViewStore((s) => s.allLenses);
  const selectLens = useViewStore((s) => s.selectLens);
  const saveLens = useViewStore((s) => s.saveLens);
  const revertLens = useViewStore((s) => s.revertLens);
  const isDraft = useViewStore((s) => s.isDraft);
  const createLens = useViewStore((s) => s.createLens);
  const errorCount = useErrorCount();

  const [pendingLensId, setPendingLensId] = useState<string | null>(null);
  const showDraftDialog = pendingLensId !== null;

  const handleLensChange = useCallback(
    (targetId: string) => {
      if (targetId === activeLensId) return;

      const currentLens = allLenses.find((l) => l.id === activeLensId);
      if (currentLens && !currentLens.isBuiltIn && isDraft(activeLensId)) {
        setPendingLensId(targetId);
        return;
      }

      selectLens(targetId);
    },
    [activeLensId, allLenses, isDraft, selectLens],
  );

  const handleSaveAndSwitch = useCallback(() => {
    saveLens(activeLensId);
    if (pendingLensId) selectLens(pendingLensId);
    setPendingLensId(null);
  }, [activeLensId, pendingLensId, saveLens, selectLens]);

  const handleDiscardAndSwitch = useCallback(() => {
    revertLens(activeLensId);
    if (pendingLensId) selectLens(pendingLensId);
    setPendingLensId(null);
  }, [activeLensId, pendingLensId, revertLens, selectLens]);

  const handleCancel = useCallback(() => {
    setPendingLensId(null);
  }, []);

  const activeLensName =
    allLenses.find((l) => l.id === activeLensId)?.name ?? "this lens";

  return (
    <>
      <Tabs.Root
        value={activeLensId}
        onValueChange={(e) => handleLensChange(e.value)}
        variant="line"
        paddingY={0}
        size="sm"
        colorPalette="blue"
        borderBottomWidth={0}
        marginBottom={"-2px"}
      >
        <HStack gap={0}>
          <Tabs.List borderBottomWidth={0}>
            {allLenses.map((lens) => (
              <LensTab
                key={lens.id}
                lens={lens}
                isActive={activeLensId === lens.id}
                isDraft={isDraft(lens.id)}
                errorCount={lens.id === "errors" ? errorCount : 0}
              />
            ))}
          </Tabs.List>
          <CreateLensButton onCreate={createLens} />
        </HStack>
      </Tabs.Root>

      <DialogRoot
        open={showDraftDialog}
        onOpenChange={(e) => { if (!e.open) handleCancel(); }}
        size="sm"
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unsaved changes</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <Text color="fg.muted" fontSize="sm">
              You have unsaved changes on <strong>{activeLensName}</strong>.
              Would you like to save or discard them?
            </Text>
          </DialogBody>
          <DialogFooter>
            <HStack gap={2}>
              <Button variant="ghost" size="sm" onClick={handleCancel}>
                Cancel
              </Button>
              <Button variant="outline" size="sm" onClick={handleDiscardAndSwitch}>
                Discard
              </Button>
              <Button colorPalette="blue" size="sm" onClick={handleSaveAndSwitch}>
                Save
              </Button>
            </HStack>
          </DialogFooter>
        </DialogContent>
      </DialogRoot>
    </>
  );
};

interface LensTabProps {
  lens: LensConfig;
  isActive: boolean;
  isDraft: boolean;
  errorCount: number;
}

const LensTab: React.FC<LensTabProps> = ({
  lens,
  isActive,
  isDraft,
  errorCount,
}) => {
  const saveLens = useViewStore((s) => s.saveLens);
  const revertLens = useViewStore((s) => s.revertLens);
  const renameLens = useViewStore((s) => s.renameLens);
  const duplicateLens = useViewStore((s) => s.duplicateLens);
  const deleteLens = useViewStore((s) => s.deleteLens);

  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(lens.name);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const handleRenameStart = useCallback(() => {
    setRenameValue(lens.name);
    setIsRenaming(true);
    setTimeout(() => renameInputRef.current?.focus(), 0);
  }, [lens.name]);

  const handleRenameConfirm = useCallback(() => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== lens.name) {
      renameLens(lens.id, trimmed);
    }
    setIsRenaming(false);
  }, [renameValue, lens.name, lens.id, renameLens]);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleRenameConfirm();
      } else if (e.key === "Escape") {
        setIsRenaming(false);
        setRenameValue(lens.name);
      }
    },
    [handleRenameConfirm, lens.name],
  );

  const tabContent = (
    <Tabs.Trigger value={lens.id}>
      {isRenaming ? (
        <Input
          ref={renameInputRef}
          size="xs"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={handleRenameConfirm}
          onKeyDown={handleRenameKeyDown}
          onClick={(e) => e.stopPropagation()}
          width="80px"
          paddingX={1}
          paddingY={0}
          height="20px"
        />
      ) : (
        <>
          {lens.name}
          {isDraft && (
            <Box
              as="span"
              width="6px"
              height="6px"
              borderRadius="full"
              backgroundColor="blue.500"
              display="inline-block"
              marginLeft={1}
              flexShrink={0}
            />
          )}
        </>
      )}
      {errorCount > 0 && (
        <Badge
          size="xs"
          variant="solid"
          colorPalette="red"
          borderRadius="full"
          marginLeft={1}
        >
          {errorCount}
        </Badge>
      )}
    </Tabs.Trigger>
  );

  if (lens.isBuiltIn) {
    return (
      <MenuRoot>
        <MenuContextTrigger asChild>{tabContent}</MenuContextTrigger>
        <MenuContent minWidth="160px">
          <MenuItem
            value="duplicate"
            onClick={() => duplicateLens(lens.id)}
          >
            <LuCopy />
            Duplicate
          </MenuItem>
        </MenuContent>
      </MenuRoot>
    );
  }

  return (
    <MenuRoot>
      <MenuContextTrigger asChild>{tabContent}</MenuContextTrigger>
      <MenuContent minWidth="160px">
        <MenuItem
          value="save"
          onClick={() => saveLens(lens.id)}
          disabled={!isDraft}
        >
          <LuSave />
          Save
        </MenuItem>
        <MenuItem
          value="revert"
          onClick={() => revertLens(lens.id)}
          disabled={!isDraft}
        >
          <LuUndo2 />
          Revert
        </MenuItem>
        <MenuSeparator />
        <MenuItem value="rename" onClick={handleRenameStart}>
          <LuPencil />
          Rename
        </MenuItem>
        <MenuItem
          value="duplicate"
          onClick={() => duplicateLens(lens.id)}
        >
          <LuCopy />
          Duplicate
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          value="delete"
          onClick={() => deleteLens(lens.id)}
          color="fg.error"
        >
          <LuTrash2 />
          Delete
        </MenuItem>
      </MenuContent>
    </MenuRoot>
  );
};

interface CreateLensButtonProps {
  onCreate: (name: string) => string;
}

const CreateLensButton: React.FC<CreateLensButtonProps> = ({ onCreate }) => {
  const [newName, setNewName] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleCreate = useCallback(() => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    onCreate(trimmed);
    setNewName("");
    setOpen(false);
  }, [newName, onCreate]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleCreate();
      } else if (e.key === "Escape") {
        setOpen(false);
        setNewName("");
      }
    },
    [handleCreate],
  );

  return (
    <PopoverRoot
      open={open}
      onOpenChange={(e) => {
        setOpen(e.open);
        if (e.open) {
          setTimeout(() => inputRef.current?.focus(), 0);
        } else {
          setNewName("");
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          size="xs"
          variant="ghost"
          marginLeft={1}
          minWidth="auto"
          paddingX={1}
          aria-label="Create new lens"
        >
          <LuPlus />
        </Button>
      </PopoverTrigger>
      <PopoverContent width="240px">
        <PopoverBody>
          <HStack gap={2}>
            <Input
              ref={inputRef}
              size="sm"
              placeholder="Lens name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <Button
              size="sm"
              colorPalette="blue"
              onClick={handleCreate}
              disabled={!newName.trim()}
            >
              Create
            </Button>
          </HStack>
        </PopoverBody>
      </PopoverContent>
    </PopoverRoot>
  );
};
