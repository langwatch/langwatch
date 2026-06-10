import { Button, Icon, Text } from "@chakra-ui/react";
import { useState } from "react";
import { LuCheck, LuCopy } from "react-icons/lu";

export function MarkdownCopyButton({ markdown }: { markdown: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    void navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Button
      size="xs"
      variant="outline"
      colorPalette="blue"
      onClick={handleCopy}
      paddingX={2}
      height="24px"
      gap={1}
    >
      <Icon as={copied ? LuCheck : LuCopy} boxSize={3} />
      <Text textStyle="2xs" fontWeight="semibold">
        {copied ? "Copied" : "Copy"}
      </Text>
    </Button>
  );
}
