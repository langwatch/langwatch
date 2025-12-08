import React from "react";
import { HStack, Text, Icon } from "@chakra-ui/react";
import { BookOpen, ExternalLink } from "lucide-react";
import { Link } from "../../../../../components/ui/link";

interface DocsLinksProps {
  docs?: {
    internal?: string;
    external?: string;
  };
  label: string;
}

export function DocsLinks({ docs, label }: DocsLinksProps): React.ReactElement | null {
  if (!docs || (!docs.internal && !docs.external)) return null;

  return (
    <HStack
      gap={3}
      color="fg.muted"
      fontSize="xs"
      justify="flex-start"
      align="center"
      pt={1}
    >
      {docs.internal && (
        <Link href={`https://docs.langwatch.ai${docs.internal}`} isExternal>
          <HStack gap={1} _hover={{ color: "fg" }} transition="color 0.2s">
            <Icon size="xs">
              <BookOpen size={12} />
            </Icon>
            <Text>LangWatch Docs</Text>
          </HStack>
        </Link>
      )}
      {docs.internal && docs.external ? (
        <Text aria-hidden>•</Text>
      ) : null}
      {docs.external && (
        <Link href={docs.external} isExternal>
          <HStack gap={1} _hover={{ color: "fg" }} transition="color 0.2s">
            <Icon size="xs">
              <ExternalLink size={12} />
            </Icon>
            <Text>{label} Docs</Text>
          </HStack>
        </Link>
      )}
    </HStack>
  );
}

