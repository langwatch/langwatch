import { HStack, Icon, IconButton, Text, VStack } from "@chakra-ui/react";
import { Tooltip } from "@langwatch/design-system/tooltip";
import type { ShareLink, ShareVisibility } from "@langwatch/share-contract";
import type { IconType } from "react-icons";
import { LuBuilding2, LuCopy, LuFolderClosed, LuGlobe, LuTrash2 } from "react-icons/lu";
import { describeShareLink, isShareLinkSpent } from "./share-link-status";
import { shareUrlForToken } from "./share-url";

/** Terse labels for the link list — the icon already carries the meaning, and
 *  the full phrasing lives in the "Who can access" select. */
const AUDIENCE: Record<ShareVisibility, { label: string; icon: IconType }> = {
  PUBLIC: { label: "Anyone", icon: LuGlobe },
  ORGANIZATION: { label: "Organization", icon: LuBuilding2 },
  PROJECT: { label: "Project", icon: LuFolderClosed },
};

export function ShareLinkRow({
  link,
  isFirst,
  isRevoking,
  onCopy,
  onRevoke,
}: {
  link: ShareLink;
  isFirst: boolean;
  isRevoking: boolean;
  /** The host owns how a copy is reported; this row only asks for one. */
  onCopy: (url: string) => void;
  onRevoke: () => void;
}) {
  const url = shareUrlForToken(link.token);
  const audience = AUDIENCE[link.visibility];

  return (
    <HStack
      gap={2}
      paddingY={3}
      paddingX={2}
      marginX={-2}
      borderRadius="md"
      borderTopWidth={isFirst ? undefined : "1px"}
      borderColor="border.muted"
      _hover={{ bg: "bg.muted/50" }}
      // A spent link stays visible so it can be revoked, but reads as inert.
      opacity={isShareLinkSpent({ link }) ? 0.55 : 1}
    >
      <VStack align="start" gap={0.5} flex="1" minWidth={0}>
        <Text fontFamily="mono" fontSize="xs" color="fg" truncate width="full">
          {url}
        </Text>
        <HStack gap={1.5} color="fg.muted" fontSize="xs">
          <Icon as={audience.icon} boxSize={3} />
          <Text>{audience.label}</Text>
          <Text aria-hidden>·</Text>
          <Text>{describeShareLink({ link })}</Text>
        </HStack>
      </VStack>

      <Tooltip content="Copy link">
        <IconButton aria-label="Copy link" variant="ghost" size="sm" onClick={() => onCopy(url)}>
          <Icon as={LuCopy} boxSize={4} />
        </IconButton>
      </Tooltip>
      <Tooltip content="Revoke link">
        <IconButton
          aria-label="Revoke link"
          variant="ghost"
          size="sm"
          colorPalette="red"
          loading={isRevoking}
          onClick={onRevoke}
        >
          <Icon as={LuTrash2} boxSize={4} />
        </IconButton>
      </Tooltip>
    </HStack>
  );
}
