import {
  Button,
  Portal,
  useFilter,
  useListbox,
  useListCollection,
} from "@chakra-ui/react";
import { ChevronDown } from "lucide-react";
import { useRef, useState } from "react";
import { Listbox } from "../ui/listbox";
import { Popover } from "../ui/popover";
import { useAllPromptsForProject } from "../../prompts/hooks/useAllPromptsForProject";

interface PromptSelectorProps {
  value: string[];
  onChange: (value: string[]) => void;
}

/**
 * Dropdown selector for prompts from the library.
 * Uses Listbox with Popover pattern per Chakra recommendations.
 */
export function PromptSelector({ value, onChange }: PromptSelectorProps) {
  const { data: prompts } = useAllPromptsForProject();
  const [inputValue, setInputValue] = useState("");
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const { contains } = useFilter({ sensitivity: "base" });

  const initialItems = (prompts?.filter((p) => p.version > 0) ?? []).map((p) => ({
    label: p.handle ?? p.id,
    value: p.id,
  }));

  const { collection, filter } = useListCollection({
    initialItems,
    filter: contains,
  });

  const listbox = useListbox({
    collection,
    value,
    onValueChange(details) {
      onChange(details.value);
      setOpen(false);
      setInputValue("");
      triggerRef.current?.focus();
    },
  });

  const selectedItem = listbox.selectedItems[0];

  return (
    <Popover.Root
      open={open}
      onOpenChange={(e) => setOpen(e.open)}
      positioning={{ placement: "top-start" }}
    >
      <Popover.Trigger asChild>
        <Button ref={triggerRef} variant="outline" size="sm" minWidth="200px">
          {selectedItem ? selectedItem.label : "Select prompt"}
          <ChevronDown size={14} />
        </Button>
      </Popover.Trigger>

      <Portal>
        <Popover.Content width="250px" padding={0}>
          <Listbox.RootProvider value={listbox} gap="0" overflow="hidden">
            <Listbox.Input
              minH="10"
              px="3"
              bg="transparent"
              outline="0"
              placeholder="Search prompts..."
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.currentTarget.value);
                filter(e.currentTarget.value);
              }}
            />
            <Listbox.Content
              borderWidth="0"
              borderTopWidth="1px"
              roundedTop="0"
              gap="0"
            >
              {collection.items.map((prompt) => (
                <Listbox.Item key={prompt.value} item={prompt}>
                  <Listbox.ItemText>{prompt.label}</Listbox.ItemText>
                  <Listbox.ItemIndicator />
                </Listbox.Item>
              ))}
            </Listbox.Content>
          </Listbox.RootProvider>
        </Popover.Content>
      </Portal>
    </Popover.Root>
  );
}

