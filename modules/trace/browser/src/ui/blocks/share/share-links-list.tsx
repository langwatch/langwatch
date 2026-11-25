import { Text, VStack } from "@langwatch/design-system/primitives";
import { SkeletonRows } from "@langwatch/design-system/skeletons";

import type { ShareLinkView } from "../../../model/share/share-link-status.ts";
import { ShareLinkRow } from "./share-link-row.tsx";

/** The list of existing links, with loading / error / empty states. */
export function ShareLinksList({
  links,
  isLoading,
  isError,
  revokingId,
  onCopy,
  onRevoke,
}: {
  links: ShareLinkView[];
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
        fontWeight="semibold"
        color="fg.muted"
        textTransform="uppercase"
        letterSpacing="wide"
        marginBottom={1}
      >
        Links
      </Text>

      <ShareLinksBody
        links={links}
        isLoading={isLoading}
        isError={isError}
        revokingId={revokingId}
        onCopy={onCopy}
        onRevoke={onRevoke}
      />
    </VStack>
  );
}

function ShareLinksBody({
  links,
  isLoading,
  isError,
  revokingId,
  onCopy,
  onRevoke,
}: Parameters<typeof ShareLinksList>[0]) {
  if (isLoading) {
    return <SkeletonRows rows={2} />;
  }
  if (isError) {
    return (
      <Text color="fg.error" fontSize="sm" paddingY={3}>
        Couldn&apos;t load share links. Please try again.
      </Text>
    );
  }
  if (links.length === 0) {
    return (
      <Text color="fg.muted" fontSize="sm" paddingY={3}>
        No links yet.
      </Text>
    );
  }
  return links.map((link, index) => (
    <ShareLinkRow
      key={link.id}
      link={link}
      isFirst={index === 0}
      isRevoking={revokingId === link.id}
      onCopy={onCopy}
      onRevoke={() => onRevoke(link.id)}
    />
  ));
}
