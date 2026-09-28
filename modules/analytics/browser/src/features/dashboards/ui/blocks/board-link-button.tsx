/**
 * The share icon of a board nobody can re-scope, the Flight Deck: it copies the
 * board's link, dressed as the visibility control a member's own board carries.
 */

import { IconButton } from "@chakra-ui/react";
import { Share2 } from "lucide-react";

import { useCopyBoardLink } from "../../behavior/use-copy-board-link.ts";

export function BoardLinkButton({ dashboardId }: { dashboardId: string }) {
  const copyLink = useCopyBoardLink({ dashboardId });
  return (
    <IconButton
      variant="ghost"
      height={8}
      minWidth={0}
      paddingX={2}
      borderRadius="lg"
      color="fg.subtle"
      _hover={{ background: "bg.muted", color: "fg" }}
      aria-label="Copy link"
      title="Copy link"
      onClick={copyLink}
    >
      <Share2 size={15} strokeWidth={2} />
    </IconButton>
  );
}
