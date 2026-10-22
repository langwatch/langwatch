import { Box, IconButton } from "@langwatch/design-system/primitives";
import { X } from "lucide-react";

import type { Announcement } from "../../navigation/model/nav.ts";
import { InlineContent } from "../../shell/ui/inline-content.tsx";

/** The docs.json banner, above the release update; dismissal is keyed by its content. */
export function SiteAnnouncement({ announcement }: { announcement: Announcement | null }) {
  if (!announcement) return null;
  return (
    <Box
      as="aside"
      aria-label="Announcement"
      className="docs-banner docs-release-strip docs-announcement"
      data-docs-banner={announcement.id}
    >
      <Box as="p" className="docs-announcement-text" margin="0">
        <InlineContent nodes={announcement.content} />
      </Box>
      {announcement.dismissible ? (
        <IconButton
          aria-label="Hide notice"
          title="Hide this notice"
          data-docs-dismiss=""
          variant="ghost"
          color="fg.muted"
          minWidth="36px"
          height="36px"
        >
          <X size={14} />
        </IconButton>
      ) : null}
    </Box>
  );
}
