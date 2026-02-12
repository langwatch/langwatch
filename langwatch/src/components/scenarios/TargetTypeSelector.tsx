import {
  Button,
  createListCollection,
  Portal,
  useListbox,
} from "@chakra-ui/react";
import { ChevronDown } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Listbox } from "../ui/listbox";
import { Popover } from "../ui/popover";

export type TargetType = "prompt" | "http" | "code";

interface TargetTypeSelectorProps {
  value: TargetType;
  onChange: (value: TargetType) => void;
}

const TARGET_TYPE_OPTIONS = [
  { label: "Prompt", value: "prompt" as const },
  { label: "HTTP Agent", value: "http" as const },
  { label: "Code Agent", value: "code" as const },
];

/**
 * Dropdown selector for target type (prompt, HTTP agent, or code agent).
 */
export function TargetTypeSelector({
  value,
  onChange,
}: TargetTypeSelectorProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const collection = useMemo(
    () => createListCollection({ items: TARGET_TYPE_OPTIONS }),
    [],
  );

  const listbox = useListbox({
    collection,
    value: [value],
    onValueChange(details) {
      const newValue = details.value[0];
      if (newValue) {
        onChange(newValue as TargetType);
      }
      setOpen(false);
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
        <Button ref={triggerRef} variant="outline" size="sm" minWidth="120px">
          {selectedItem?.label ?? "Select type"}
          <ChevronDown size={14} />
        </Button>
      </Popover.Trigger>

      <Portal>
        <Popover.Content width="150px" padding={0}>
          <Listbox.RootProvider value={listbox} gap="0" overflow="hidden">
            <Listbox.Content borderWidth="0" gap="0">
              {collection.items.map((item) => (
                <Listbox.Item key={item.value} item={item}>
                  <Listbox.ItemText>{item.label}</Listbox.ItemText>
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
