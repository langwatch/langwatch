import { Box, IconButton, Link } from "@langwatch/design-system/primitives";
import { X } from "lucide-react";
import { useEffect, useState } from "react";

import { site } from "../lib/nav-model.ts";
import { readPreference, writePreference } from "../lib/storage.ts";

function hashOf({ text }: { text: string }): string {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return String(hash);
}

/** The configured `**[label](href):** rest` banner; dismissal is remembered by content hash. */
export function SiteBanner() {
  const banner = site.banner;
  const [hidden, setHidden] = useState(false);
  const key = banner ? `banner:${hashOf({ text: banner.content })}` : "";
  useEffect(() => {
    if (key && readPreference({ key }) === "dismissed") setHidden(true);
  }, [key]);
  if (!banner || hidden) return null;
  const match = /^\*\*\[([^\]]+)\]\(([^)]+)\):?\*\*:?\s*(.*)$/.exec(banner.content);
  return (
    <Box
      position="relative"
      bg="docs.primary"
      color="accent.onSolid"
      minHeight="40px"
      paddingY="2"
      paddingX="12"
      textAlign="center"
      fontSize="14px"
      lineHeight="24px"
    >
      {banner.dismissible ? (
        <IconButton
          aria-label="Dismiss announcement"
          variant="ghost"
          color="inherit"
          position="absolute"
          right="2"
          top="0"
          minWidth="40px"
          height="40px"
          onClick={() => {
            writePreference({ key, value: "dismissed" });
            setHidden(true);
          }}
        >
          <X size={16} />
        </IconButton>
      ) : null}
      {match ? (
        <>
          <Link
            href={match[2]}
            fontWeight="600"
            color="inherit"
            textDecoration="underline"
            textUnderlineOffset="2px"
          >
            {match[1]}
          </Link>{" "}
          {match[3]}
        </>
      ) : (
        banner.content
      )}
    </Box>
  );
}
