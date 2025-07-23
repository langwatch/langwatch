import { HStack, Text } from "@chakra-ui/react";
import Mustache from "mustache";
import { useState } from "react";
import { ExternalLink } from "react-feather";

import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";

import { CopyIcon } from "./icons/Copy";
import { Link as UiLink } from "./ui/link";

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
}: {
  label: string;
  value: string;
  copyable?: boolean;
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

  // Helper: render value as link if it's a URL
  const renderValue = () => {
    if (value.startsWith("http")) {
      return (
        <HStack gap={1} color="blue.500">
          <UiLink href={value} target="_blank">
            {value}
          </UiLink>
          <ExternalLink size={12} />
        </HStack>
      );
    }
    return value;
  };

  return (
    <HStack gap={0} fontSize="smaller" margin={0}>
      <Text
        borderWidth={1}
        borderColor="gray.200"
        paddingX={2}
        borderLeftRadius="md"
      >
        {label}:
      </Text>
      <HStack
        as={Text}
        borderWidth={1}
        borderColor="gray.200"
        paddingX={2}
        borderLeft="none"
        backgroundColor="gray.100"
        borderRightRadius="md"
        fontFamily="mono"
        gap={1}
        alignItems="center"
      >
        {renderValue()}
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
};
