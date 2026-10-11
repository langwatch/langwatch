import { Banner } from "@langwatch/design-system/banner";
import { Box, Link } from "@langwatch/design-system/primitives";
import { useEffect, useState } from "react";
import { readPreference, writePreference } from "../lib/storage.ts";
import { site } from "../lib/nav-model.ts";
import { FRAME_MAX, GUTTER } from "./layout.ts";

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
    <Box maxWidth={FRAME_MAX.guide} marginX="auto" paddingX={GUTTER} paddingTop="3">
      <Banner
        status="info"
        placement="inline"
        onDismiss={
          banner.dismissible
            ? () => {
                writePreference({ key, value: "dismissed" });
                setHidden(true);
              }
            : undefined
        }
      >
        {match ? (
          <>
            <Link href={match[2]} fontWeight="600" color="fg" textDecoration="underline" textUnderlineOffset="2px">
              {match[1]}
            </Link>{" "}
            {match[3]}
          </>
        ) : (
          banner.content
        )}
      </Banner>
    </Box>
  );
}
