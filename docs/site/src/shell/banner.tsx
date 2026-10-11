import { Box, Flex, IconButton, Link, Text } from "@langwatch/design-system/primitives";
import { ArrowUpRight, Sparkles, X } from "lucide-react";
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
      className="docs-banner"
      bg="docs.banner"
      color="docs.bannerText"
      minHeight="36px"
      paddingY="1"
      paddingX="12"
      textAlign="center"
      fontSize="13px"
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
          minWidth="36px"
          height="36px"
          onClick={() => {
            writePreference({ key, value: "dismissed" });
            setHidden(true);
          }}
        >
          <X size={16} />
        </IconButton>
      ) : null}
      {match ? (
        <Flex alignItems="center" justifyContent="center" gap="3" minHeight="28px">
          <Sparkles size={14} aria-hidden="true" />
          <Link
            href={match[2]}
            fontWeight="500"
            color="inherit"
            textDecoration="none"
            _hover={{ textDecoration: "underline" }}
            display="inline-flex"
            gap="2"
            alignItems="center"
          >
            <Text as="span" truncate>
              {match[1]}
            </Text>
            <ArrowUpRight size={13} aria-hidden="true" />
          </Link>
          <Box as="span" display={{ base: "none", xl: "inline" }} opacity="0.85">
            {match[3]}
          </Box>
        </Flex>
      ) : (
        banner.content
      )}
    </Box>
  );
}
