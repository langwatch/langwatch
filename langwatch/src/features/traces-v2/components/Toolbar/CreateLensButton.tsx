import { Button, HStack, Input } from "@chakra-ui/react";
import { useState } from "react";
import type React from "react";
import { LuPlus } from "react-icons/lu";
import {
  PopoverBody,
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "../../../../components/ui/popover";
import { useViewStore } from "../../stores/viewStore";

export const CreateLensButton: React.FC = () => {
  const createLens = useViewStore((s) => s.createLens);
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);

  const reset = () => {
    setName("");
    setOpen(false);
  };

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    createLens(trimmed);
    reset();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") submit();
    else if (e.key === "Escape") reset();
  };

  return (
    <PopoverRoot
      open={open}
      onOpenChange={(e) => {
        setOpen(e.open);
        if (!e.open) setName("");
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
              autoFocus
              size="sm"
              placeholder="Lens name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <Button
              size="sm"
              colorPalette="blue"
              onClick={submit}
              disabled={!name.trim()}
            >
              Create
            </Button>
          </HStack>
        </PopoverBody>
      </PopoverContent>
    </PopoverRoot>
  );
};
