import { Box, Button, Collapsible, HStack, Text } from "@chakra-ui/react";
import { Check, ChevronDown, ChevronRight, Copy } from "lucide-react";
import { useState } from "react";
import { Tooltip } from "@langwatch/design-system/tooltip";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Tooltip content={copied ? "Copied!" : label}>
      <Button variant="ghost" size="xs" onClick={handleCopy} padding={1} minWidth="auto">
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </Button>
    </Tooltip>
  );
}

export function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
  badge,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  badge?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible.Root
      open={open}
      onOpenChange={({ open: nextOpen }) => setOpen(nextOpen)}
    >
      <Collapsible.Trigger asChild>
        <HStack gap={2} width="full" mb={2}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Text fontSize="sm" fontWeight="medium">
            {title}
          </Text>
          {badge}
        </HStack>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <Box paddingLeft={6} paddingY={2}>
          {children}
        </Box>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
