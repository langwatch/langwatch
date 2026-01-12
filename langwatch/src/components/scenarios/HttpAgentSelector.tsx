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
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";

interface HttpAgentSelectorProps {
  value: string | null;
  onChange: (value: string | null) => void;
}

/**
 * Dropdown selector for HTTP agents.
 * Uses Listbox with Popover pattern per Chakra recommendations.
 */
export function HttpAgentSelector({ value, onChange }: HttpAgentSelectorProps) {
  const { project } = useOrganizationTeamProject();
  const { data: agents } = api.agents.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );
  const [inputValue, setInputValue] = useState("");
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Filter to only HTTP agents
  const httpAgents = useMemo(
    () => agents?.filter((a) => a.type === "http") ?? [],
    [agents],
  );

  const collection = useMemo(() => {
    const allItems = httpAgents.map((a) => ({
      label: a.name,
      value: a.id,
    }));

    const filteredItems = inputValue
      ? allItems.filter((item) =>
          item.label.toLowerCase().includes(inputValue.toLowerCase()),
        )
      : allItems;

    return createListCollection({ items: filteredItems });
  }, [httpAgents, inputValue]);

  const listbox = useListbox({
    collection,
    value: value ? [value] : [],
    onValueChange(details) {
      onChange(details.value[0] ?? null);
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
          {selectedItem ? selectedItem.label : "Select HTTP agent"}
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
              placeholder="Search HTTP agents..."
              value={inputValue}
              onChange={(e) => setInputValue(e.currentTarget.value)}
            />
            <Listbox.Content
              borderWidth="0"
              borderTopWidth="1px"
              roundedTop="0"
              gap="0"
            >
              {collection.items.map((agent) => (
                <Listbox.Item key={agent.value} item={agent}>
                  <Listbox.ItemText>{agent.label}</Listbox.ItemText>
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
