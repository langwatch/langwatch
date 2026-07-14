import {
  HStack,
  IconButton,
  Input,
  /* eslint-disable-next-line no-restricted-imports */
  InputGroup,
  type InputProps,
  Text,
} from "@chakra-ui/react";
import { Clipboard, ClipboardPlus, Eye, EyeOff } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { useColorModeValue } from "~/components/ui/color-mode";
import { Tooltip } from "../../../../../components/ui/tooltip";

interface InputWithPrefixProps {
  value: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  readOnly?: boolean;
  type?: string;
  ariaLabel: string;
  autoComplete?: string;
  prefix?: string;
  showVisibilityToggle?: boolean;
  onCopyPlain?: () => Promise<void>;
  onCopyWithPrefix?: () => Promise<void>;
  invalid?: boolean;
}

/**
 * A flexible input component with optional prefix, visibility toggle, and copy actions.
 *
 * Single Responsibility: Provides a unified input field with configurable addons for prefixes and action buttons.
 */
export function InputWithPrefix({
  value,
  onChange,
  placeholder,
  readOnly = false,
  type,
  ariaLabel,
  autoComplete = "off",
  prefix,
  showVisibilityToggle = false,
  onCopyPlain,
  onCopyWithPrefix,
  invalid = false,
}: InputWithPrefixProps): React.ReactElement {
  const [isVisible, setIsVisible] = useState(false);
  const focusBoxShadow = useColorModeValue<InputProps["boxShadow"]>(
    "sm",
    "2xl",
  );
  const borderColor = invalid ? "border.error" : "border";

  function toggleVisibility(): void {
    setIsVisible((prev) => !prev);
  }

  const hasEndAddon = showVisibilityToggle || onCopyPlain || onCopyWithPrefix;
  const inputType =
    type ?? (showVisibilityToggle && !isVisible ? "password" : "text");

  return (
    <InputGroup
      w="full"
      _focusWithin={{
        boxShadow: focusBoxShadow,
        borderRadius: "sm",
      }}
      startAddonProps={
        prefix
          ? {
              bg: "bg.muted/60",
              color: "fg.muted",
              borderColor,
              borderWidth: "1px",
              borderEndWidth: 0,
            }
          : undefined
      }
      startAddon={prefix ? <Text fontSize="xs">{prefix}</Text> : undefined}
      endAddonProps={
        hasEndAddon
          ? {
              bg: "bg.muted/40",
              color: "fg.muted",
              borderColor,
              borderWidth: "1px",
              borderStartWidth: 0,
            }
          : undefined
      }
      endAddon={
        hasEndAddon ? (
          <HStack gap="1">
            {showVisibilityToggle && (
              <Tooltip
                content={isVisible ? "Hide value" : "Show value"}
                openDelay={0}
                showArrow
              >
                <IconButton
                  size="2xs"
                  variant="ghost"
                  onClick={toggleVisibility}
                  aria-label={isVisible ? "Hide value" : "Show value"}
                >
                  {isVisible ? <EyeOff /> : <Eye />}
                </IconButton>
              </Tooltip>
            )}
            {onCopyPlain && (
              <Tooltip
                content={`Copy ${ariaLabel.toLowerCase()}`}
                openDelay={0}
                showArrow
              >
                <IconButton
                  size="2xs"
                  variant="ghost"
                  onClick={() => void onCopyPlain()}
                  aria-label={`Copy ${ariaLabel.toLowerCase()}`}
                >
                  <Clipboard />
                </IconButton>
              </Tooltip>
            )}
            {onCopyWithPrefix && (
              <Tooltip
                content={`Copy ${ariaLabel.toLowerCase()} with environment variable prefix`}
                openDelay={0}
                showArrow
              >
                <IconButton
                  size="2xs"
                  variant="ghost"
                  onClick={() => void onCopyWithPrefix()}
                  aria-label={`Copy ${ariaLabel.toLowerCase()} with prefix`}
                >
                  <ClipboardPlus />
                </IconButton>
              </Tooltip>
            )}
          </HStack>
        ) : undefined
      }
    >
      <Input
        data-op-ignore
        bg="bg.muted/40"
        borderEndWidth={hasEndAddon ? 0 : undefined}
        borderStartWidth={prefix ? 0 : undefined}
        borderColor={borderColor}
        size="sm"
        variant="outline"
        type={inputType}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        readOnly={readOnly}
        autoComplete={autoComplete}
        aria-label={ariaLabel}
        aria-invalid={invalid ? true : undefined}
        _focus={{
          outline: "none",
          boxShadow: "none",
          borderColor,
        }}
      />
    </InputGroup>
  );
}
