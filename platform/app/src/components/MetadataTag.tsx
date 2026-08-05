import { HStack, Text } from "@chakra-ui/react";
import Mustache from "mustache";
import { useState } from "react";
import { ExternalLink } from "react-feather";

import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";

import { CopyIcon } from "./icons/Copy";
import { Link as UiLink } from "./ui/link";
import { Popover } from "./ui/popover";

const MAX_VALUE_LENGTH = 48;

const useCopyToClipboard = () => {
  const [isCopied, setIsCopied] = useState(false);
  const copyToClipboard = (value: string) => {
    void navigator.clipboard
      .writeText(value)
      .then(() => {
        setIsCopied(true);
      })
      .catch((error) => {
        console.error("Error copying to clipboard", error);
      });
  };
  return { isCopied, copyToClipboard };
};

/**
 * MetadataTag displays a label and value, optionally as a link, and can be copyable.
 * - If `copyable` is true, shows a copy icon to copy the value.
 * - If value is a URL, renders as a clickable link.
 */
export const MetadataTag = ({
  label,
  value,
  copyable,
  onClick,
}: {
  label: string;
  value: string;
  copyable?: boolean;
  onClick?: () => void;
}) => {
  const { project } = useOrganizationTeamProject();
  const { isCopied, copyToClipboard } = useCopyToClipboard();

  // Render user_id as a link if template is present
  if (label === "user_id" && project?.userLinkTemplate) {
    const renderedValue = Mustache.render(project.userLinkTemplate, {
      user_id: value,
    });
    value = renderedValue;
  }

  const isTruncated = value.length > MAX_VALUE_LENGTH;
  const displayValue = isTruncated
    ? value.slice(0, MAX_VALUE_LENGTH) + "…"
    : value;

  // Helper: render value as link if it's a URL
  const renderValue = (text: string) => {
    if (value.startsWith("http")) {
      return (
        <HStack gap={1} color="blue.500">
          <UiLink href={value} target="_blank">
            {text}
          </UiLink>
          <ExternalLink size={12} />
        </HStack>
      );
    }
    return text;
  };

  const tag = (
    <HStack
      gap={0}
      fontSize="smaller"
      margin={0}
      onClick={isTruncated ? undefined : onClick}
      cursor={!isTruncated && onClick ? "pointer" : "default"}
    >
      <Text
        borderWidth={1}
        borderColor="border"
        paddingX={2}
        borderLeftRadius="md"
      >
        {label}:
      </Text>
      <HStack
        as={Text}
        borderWidth={1}
        borderColor="border"
        paddingX={2}
        borderLeft="none"
        backgroundColor="bg.muted"
        borderRightRadius="md"
        fontFamily="mono"
        gap={1}
        alignItems="center"
      >
        {renderValue(displayValue)}
        {copyable && (
          <CopyIcon
            style={{
              cursor: "pointer",
              opacity: isCopied ? 0.5 : 1,
              transition: "opacity 0.2s",
            }}
            width={10}
            height={10}
            onClick={(e) => {
              e.stopPropagation();
              copyToClipboard(value);
            }}
          />
        )}
      </HStack>
    </HStack>
  );

  if (!isTruncated) {
    return tag;
  }

  return (
    <Popover.Root>
      <Popover.Trigger asChild>{tag}</Popover.Trigger>
      <Popover.Content maxWidth="480px">
        <Popover.Arrow />
        <Popover.Body>
          <Text
            fontSize="sm"
            fontFamily="mono"
            whiteSpace="pre-wrap"
            wordBreak="break-all"
            maxHeight="300px"
            overflowY="auto"
          >
            {value}
          </Text>
        </Popover.Body>
      </Popover.Content>
    </Popover.Root>
  );
};
