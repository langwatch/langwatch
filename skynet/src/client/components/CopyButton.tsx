import { useState } from "react";
import { IconButton, Tooltip } from "@chakra-ui/react";
import { CopyIcon, CheckIcon } from "@chakra-ui/icons";

interface CopyButtonProps {
  value: string;
  size?: string;
}

export function CopyButton({ value, size = "14px" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Tooltip label={copied ? "Copied!" : "Copy"} openDelay={200} closeOnClick={false}>
      <IconButton
        aria-label="Copy"
        icon={copied ? <CheckIcon boxSize={size} /> : <CopyIcon boxSize={size} />}
        variant="ghost"
        size="xs"
        minW="auto"
        h="auto"
        p="2px"
        color={copied ? "#00ff41" : "#4a6a7a"}
        _hover={{ color: "#00f0ff" }}
        onClick={handleCopy}
      />
    </Tooltip>
  );
}
