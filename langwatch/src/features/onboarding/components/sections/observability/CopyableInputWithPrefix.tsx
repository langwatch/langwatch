import React, { useState } from "react";
import {
  HStack,
  IconButton,
  Input,
  Text,
  /* eslint-disable-next-line no-restricted-imports */
  InputGroup,
} from "@chakra-ui/react";
import { Eye, EyeOff, Clipboard, ClipboardPlus } from "lucide-react";
import { Tooltip } from "~/components/ui/tooltip";

interface CopyableInputWithPrefixProps {
  prefix: string;
  value: string;
  ariaLabel: string;
  showVisibilityToggle?: boolean;
  onCopy: (options: { withBashPrefix: boolean }) => Promise<void>;
}

export function CopyableInputWithPrefix({
  prefix,
  value,
  ariaLabel,
  showVisibilityToggle = false,
  onCopy,
}: CopyableInputWithPrefixProps): React.ReactElement {
  const [isVisible, setIsVisible] = useState(false);

  function toggleVisibility(): void {
    setIsVisible((prev) => !prev);
  }

  return (
    <InputGroup
      w="full"
      _focusWithin={{
        boxShadow: "sm",
        borderRadius: "sm",
      }}
      startAddonProps={{ bg: "bg.muted/60", color: "fg.muted", borderColor: "border", borderWidth: "1px", borderEndWidth: 0 }}
      startAddon={<Text fontSize="xs">{prefix}</Text>}
      endAddonProps={{ bg: "bg.muted/40", color: "fg.muted", borderColor: "border", borderWidth: "1px", borderStartWidth: 0 }}
      endAddon={
        <HStack gap="1">
          {showVisibilityToggle && (
            <IconButton
              size="2xs"
              variant="ghost"
              onClick={toggleVisibility}
              aria-label={isVisible ? "Hide key" : "Show key"}
            >
              {isVisible ? <EyeOff /> : <Eye />}
            </IconButton>
          )}
          <Tooltip content={`Copy ${ariaLabel.toLowerCase()}`} openDelay={0} showArrow>
            <IconButton
              size="2xs"
              variant="ghost"
              onClick={() => void onCopy({ withBashPrefix: false })}
              aria-label={`Copy ${ariaLabel.toLowerCase()}`}
            >
              <Clipboard />
            </IconButton>
          </Tooltip>
          <Tooltip content={`Copy ${ariaLabel.toLowerCase()} with environment variable prefix`} openDelay={0} showArrow>
            <IconButton
              size="2xs"
              variant="ghost"
              onClick={() => void onCopy({ withBashPrefix: true })}
              aria-label={`Copy ${ariaLabel.toLowerCase()} with bash prefix`}
            >
              <ClipboardPlus />
            </IconButton>
          </Tooltip>
        </HStack>
      }
    >
      <Input
        bg="bg.muted/40"
        borderEndWidth={0}
        borderStartWidth={0}
        size="sm"
        variant="outline"
        type={showVisibilityToggle && !isVisible ? "password" : "text"}
        value={value}
        readOnly
        aria-label={ariaLabel}
        _focus={{
          outline: "none",
          boxShadow: "none",
          borderColor: "border",
        }}
      />
    </InputGroup>
  );
}

