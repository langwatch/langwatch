import { Button, HStack, Spinner, Text } from "@chakra-ui/react";
import { Play, Square, Trash2, X } from "lucide-react";
import { useState } from "react";

import {
  DialogBody,
  DialogCloseTrigger,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "~/components/ui/dialog";

export type SelectionToolbarProps = {
  selectedCount: number;
  onRun: () => void;
  onStop?: () => void;
  onDelete: () => void;
  onClear: () => void;
  /** Whether these specific rows are currently being executed */
  isRunning?: boolean;
  /** Whether an abort request is in progress */
  isAborting?: boolean;
};

export function SelectionToolbar({
  selectedCount,
  onRun,
  onStop,
  onDelete,
  onClear,
  isRunning = false,
  isAborting = false,
}: SelectionToolbarProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  if (selectedCount === 0) return null;

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = () => {
    onDelete();
    setShowDeleteConfirm(false);
  };

  const handleRunClick = () => {
    if (isRunning && onStop) {
      onStop();
    } else {
      onRun();
    }
  };

  return (
    <>
      <HStack
        position="fixed"
        bottom={4}
        left="50%"
        transform="translateX(-50%)"
        paddingX={4}
        paddingY={2}
        borderRadius="lg"
        boxShadow="lg"
        gap={3}
        zIndex={100}
        bg="bg.panel"
      >
        <Text fontSize="sm" data-testid="selection-count">
          {selectedCount} selected
        </Text>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleRunClick}
          disabled={isAborting}
          data-testid="selection-run-btn"
        >
          {isAborting ? (
            <>
              <Spinner size="xs" /> Stopping...
            </>
          ) : isRunning ? (
            <>
              <Square size={16} /> Stop
            </>
          ) : (
            <>
              <Play size={16} /> Run
            </>
          )}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleDeleteClick}
          disabled={isRunning}
          data-testid="selection-delete-btn"
        >
          <Trash2 size={16} /> Delete
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onClear}
          data-testid="selection-clear-btn"
        >
          <X size={16} />
        </Button>
      </HStack>

      <DialogRoot
        open={showDeleteConfirm}
        onOpenChange={({ open }) => setShowDeleteConfirm(open)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Delete {selectedCount} row{selectedCount > 1 ? "s" : ""}?
            </DialogTitle>
          </DialogHeader>
          <DialogCloseTrigger />
          <DialogBody>
            <Text>
              Are you sure you want to delete {selectedCount} selected row
              {selectedCount > 1 ? "s" : ""}?
            </Text>
          </DialogBody>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteConfirm(false)}
              data-testid="delete-cancel-btn"
            >
              Cancel
            </Button>
            <Button
              colorPalette="red"
              onClick={handleConfirmDelete}
              data-testid="delete-confirm-btn"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </DialogRoot>
    </>
  );
}
