import { Box, HStack, IconButton, Text } from "@chakra-ui/react";
import { Clipboard, ClipboardPlus, Eye, EyeOff } from "lucide-react";
import type React from "react";
import { useState } from "react";
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

  function getMaskedValue(): string {
    if (!showVisibilityToggle || isVisible) return value;
    if (value.length <= 16) return "••••••••";
    return `${value.slice(0, 4)}••••••••${value.slice(-4)}`;
  }

  return (
    <Box
      position="relative"
      borderRadius="xl"
      border="1px solid"
      borderColor="gray.200"
      bg="white/70"
      backdropFilter="blur(24px) saturate(1.4)"
      boxShadow="0 4px 30px rgba(0,0,0,0.06), inset 0 1px 0 white"
      overflow="hidden"
      transition="all 0.2s ease"
      _hover={{
        borderColor: "gray.300",
        boxShadow:
          "0 8px 40px rgba(0,0,0,0.08), inset 0 1px 0 white",
      }}
    >
      <Box
        px={5}
        py={3.5}
        pr={showVisibilityToggle ? "120px" : "90px"}
        fontSize="xs"
        lineHeight="tall"
        fontFamily="mono"
        color="fg.DEFAULT"
        whiteSpace="nowrap"
        overflow="hidden"
        textOverflow="ellipsis"
        aria-label={ariaLabel}
      >
        <Text as="span" color="fg.muted">
          {prefix}
        </Text>
        {getMaskedValue()}
      </Box>

      <HStack position="absolute" top="50%" right={2} transform="translateY(-50%)" gap="0.5">
        {showVisibilityToggle && (
          <Tooltip
            content={isVisible ? "Hide" : "Show"}
            openDelay={0}
            showArrow
          >
            <IconButton
              size="xs"
              variant="ghost"
              onClick={toggleVisibility}
              aria-label={isVisible ? "Hide key" : "Show key"}
              backdropFilter="blur(8px)"
              bg="white/50"
              borderRadius="lg"
              _hover={{ bg: "white/70" }}
            >
              {isVisible ? <EyeOff size={14} /> : <Eye size={14} />}
            </IconButton>
          </Tooltip>
        )}
        <Tooltip
          content={`Copy ${ariaLabel.toLowerCase()}`}
          openDelay={0}
          showArrow
        >
          <IconButton
            size="xs"
            variant="ghost"
            onClick={() => void onCopy({ withBashPrefix: false })}
            aria-label={`Copy ${ariaLabel.toLowerCase()}`}
            backdropFilter="blur(8px)"
            bg="white/50"
            borderRadius="lg"
            _hover={{ bg: "white/70" }}
          >
            <Clipboard size={14} />
          </IconButton>
        </Tooltip>
        <Tooltip
          content={`Copy with env prefix`}
          openDelay={0}
          showArrow
        >
          <IconButton
            size="xs"
            variant="ghost"
            onClick={() => void onCopy({ withBashPrefix: true })}
            aria-label={`Copy ${ariaLabel.toLowerCase()} with bash prefix`}
            backdropFilter="blur(8px)"
            bg="white/50"
            borderRadius="lg"
            _hover={{ bg: "white/70" }}
          >
            <ClipboardPlus size={14} />
          </IconButton>
        </Tooltip>
      </HStack>
    </Box>
  );
}
