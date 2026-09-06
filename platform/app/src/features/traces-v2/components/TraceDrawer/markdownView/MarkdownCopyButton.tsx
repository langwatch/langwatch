import { Button, Icon, Text } from "@chakra-ui/react";
import { LuCheck, LuCopy } from "react-icons/lu";
import { useCopyToClipboard } from "../../../hooks/useCopyToClipboard";

export function MarkdownCopyButton({ markdown }: { markdown: string }) {
  const { copied, copy } = useCopyToClipboard();
  const handleCopy = () => copy(markdown);
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
