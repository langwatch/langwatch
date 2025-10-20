import React, { useState } from "react";
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
import { useActiveProject } from "../../../context/ActiveProjectContext";

interface ApiKeyCardProps { apiKey?: string }

export function ApiKeyCard({ apiKey }: ApiKeyCardProps): React.ReactElement {
  const [isVisible, setIsVisible] = useState(false);
  const { project } = useActiveProject();
  const effectiveApiKey = project?.apiKey ?? apiKey ?? "";

  function toggleVisibility(): void {
    setIsVisible((prev) => !prev);
  }

  async function copyApiKey({ withBashPrefix }: { withBashPrefix?: boolean }): Promise<void> {
    try {
      await navigator.clipboard.writeText(withBashPrefix ? `LANGWATCH_API_KEY=${effectiveApiKey}` : effectiveApiKey);
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
        endAddonProps={{ bg: "bg.muted/40", color: "fg.muted", border: "0" }}
        endAddon={
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
          borderRight={0}
          size="sm"
          variant="subtle"
          type={isVisible ? "text" : "password"}
          value={effectiveApiKey}
          readOnly
          aria-label="Your API key"
        />
      </InputGroup>
    </VStack>
  );
}
