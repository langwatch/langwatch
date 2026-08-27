import { HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import type { ShareLink } from "@langwatch/share-contract";
import { ShareLinkRow } from "./share-link-row";

/** The list of existing links, with loading / error / empty states. */
export function ShareLinksList({
  links,
  isLoading,
  isError,
  revokingId,
  onCopy,
  onRevoke,
}: {
  links: ShareLink[];
  isLoading: boolean;
  isError: boolean;
  revokingId: string | null;
  onCopy: (url: string) => void;
  onRevoke: (id: string) => void;
}) {
  return (
    <VStack gap={0} align="stretch">
      <Text
        fontSize="xs"
        fontWeight="600"
        color="fg.muted"
        textTransform="uppercase"
        letterSpacing="wide"
        marginBottom={1}
      >
        Links
      </Text>

      {isLoading ? (
        <HStack color="fg.muted" fontSize="sm" gap={2} paddingY={3}>
          <Spinner size="sm" />
          <Text>Loading…</Text>
        </HStack>
      ) : isError ? (
        <Text color="fg.error" fontSize="sm" paddingY={3}>
          Couldn&apos;t load share links. Please try again.
        </Text>
      ) : links.length === 0 ? (
        <Text color="fg.muted" fontSize="sm" paddingY={3}>
          No links yet.
        </Text>
      ) : (
        links.map((link, index) => (
          <ShareLinkRow
            key={link.id}
            link={link}
            isFirst={index === 0}
            isRevoking={revokingId === link.id}
            onCopy={onCopy}
            onRevoke={() => onRevoke(link.id)}
          />
        ))
      )}
    </VStack>
  );
}
