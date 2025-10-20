import React, { useEffect, useState } from "react";
import {
  HStack,
  IconButton,
  Input,
  Text,
  VStack,

  /* eslint-disable-next-line no-restricted-imports */
  InputGroup,
} from "@chakra-ui/react";
import { toaster } from "../../../../../components/ui/toaster";
import { Eye, EyeOff, Clipboard, ClipboardPlus } from "lucide-react";
import { Tooltip } from "~/components/ui/tooltip";

function generateTemporaryApiKey(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let body = "";
  for (let index = 0; index < 32; index++) {
    body += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `sk-lw-${body}`;
}

interface ApiKeyCardProps {
  initialApiKey?: string;
}

export function ApiKeyCard({
  initialApiKey,
}: ApiKeyCardProps): React.ReactElement {
  const [apiKey, setApiKey] = useState<string>(initialApiKey ?? "");
  const [isVisible, setIsVisible] = useState<boolean>(false);

  useEffect(() => {
    if (!apiKey) setApiKey(generateTemporaryApiKey());
  }, [apiKey]);

  function toggleVisibility(): void {
    setIsVisible((prev) => !prev);
  }

  async function copyApiKey({ withBashPrefix }: { withBashPrefix?: boolean }): Promise<void> {
    try {
      await navigator.clipboard.writeText(withBashPrefix ? `LANGWATCH_API_KEY=${apiKey}` : apiKey);
      toaster.create({
        title: "Copied",
        description: "API key copied to clipboard",
        type: "success",
        meta: { closable: true },
      });
    } catch {
      toaster.create({
        title: "Copy failed",
        description: "Couldn't copy the API key. Please try again.",
        type: "error",
        meta: { closable: true },
      });
    }
  }

  return (
    <VStack align="stretch" gap={3}>
      <VStack align="stretch" gap={0}>
        <Text fontSize="md" fontWeight="semibold">
          Your LangWatch API key
        </Text>
        <Text fontSize="xs" color="fg.muted">
          {"You can access your API key again anytime in the project's settings "}
          {"page."}
        </Text>
      </VStack>
      <InputGroup
        w="full"
        startAddonProps={{ bg: "bg.muted/60", color: "fg.muted", border: "0"  }}
        startAddon={<Text fontSize="xs">LANGWATCH_API_KEY=</Text>}
        endElement={
          <HStack gap="1">
            <IconButton
              size="2xs"
              variant="ghost"
              onClick={toggleVisibility}
              aria-label={isVisible ? "Hide key" : "Show key"}
            >
              {isVisible ? <EyeOff /> : <Eye />}
            </IconButton>
            <Tooltip content="Copy key">
              <IconButton
                size="2xs"
                variant="ghost"
                onClick={() => void copyApiKey({ withBashPrefix: false })}
                aria-label="Copy key"
              >
                <Clipboard />
              </IconButton>
            </Tooltip>
            <Tooltip content="Copy key with bash prefix">
              <IconButton
                size="2xs"
                variant="ghost"
                onClick={() => void copyApiKey({ withBashPrefix: true })}
                aria-label="Copy key with bash prefix"
              >
                <ClipboardPlus />
              </IconButton>
            </Tooltip>
          </HStack>
        }
      >
        <Input
          bg="bg.muted/40"
          size="sm"
          variant="subtle"
          type={isVisible ? "text" : "password"}
          value={apiKey}
          readOnly
          aria-label="Your API key"
        />
      </InputGroup>
    </VStack>
  );
}
