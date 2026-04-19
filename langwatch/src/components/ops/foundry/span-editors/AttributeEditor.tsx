import { useState } from "react";
import { Flex, Text, Input, Button } from "@chakra-ui/react";
import { Plus, Trash2 } from "lucide-react";

export function AttributeEditor({
  attributes,
  onChange,
}: {
  attributes: Record<string, string | number | boolean>;
  onChange: (attrs: Record<string, string | number | boolean>) => void;
}) {
  const entries = Object.entries(attributes);
  const [newKey, setNewKey] = useState("");

  function addAttribute() {
    if (!newKey || newKey in attributes) return;
    onChange({ ...attributes, [newKey]: "" });
    setNewKey("");
  }

  function updateValue(key: string, raw: string) {
    let value: string | number | boolean = raw;
    if (raw === "true") value = true;
    else if (raw === "false") value = false;
    else if (/^\d+(\.\d+)?$/.test(raw)) value = parseFloat(raw);
    onChange({ ...attributes, [key]: value });
  }

  return (
    <Flex direction="column" gap={1} mt={1}>
      {entries.map(([key, value]) => (
        <Flex key={key} align="center" gap={2}>
          <Text fontSize="xs" color="fg.subtle" w="140px" flexShrink={0} truncate>{key}</Text>
          <Input
            size="sm"
            flex={1}
            fontSize="xs"
            value={String(value)}
            onChange={(e) => updateValue(key, e.target.value)}
          />
          <Button size="xs" variant="ghost" color="fg.muted" _hover={{ color: "red.400" }}
            onClick={() => { const next = { ...attributes }; delete next[key]; onChange(next); }}>
            <Trash2 size={12} />
          </Button>
        </Flex>
      ))}
      <Flex align="center" gap={2}>
        <Input
          size="sm"
          w="140px"
          flexShrink={0}
          fontSize="xs"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addAttribute()}
          placeholder="attribute.key"
        />
        <Button size="xs" variant="outline" onClick={addAttribute} disabled={!newKey}>
          <Plus size={12} /> Add
        </Button>
      </Flex>
    </Flex>
  );
}
