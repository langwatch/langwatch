import { Box, IconButton, Link } from "@langwatch/design-system/primitives";
import { ArrowRight, X } from "lucide-react";

import { sitePath } from "../../../lib/site-path.ts";
import { site } from "../../navigation/ui.ts";

export function SiteBanner() {
  const release = site.releases[0];
  if (!release) return null;
  return (
    <Box
      as="aside"
      aria-label="Latest release"
      className="docs-banner docs-release-strip"
      data-docs-banner={`release:${release.version}`}
    >
      <Link className="docs-release-link" href={sitePath({ path: release.href })}>
        <Box as="span" className="docs-release-label">
          What’s new
        </Box>
        <Box as="span" className="docs-release-version">
          v{release.version}
        </Box>
        <Box as="span" className="docs-release-summary">
          {release.summary}
        </Box>
        <time dateTime={release.date}>{release.label}</time>
        <ArrowRight size={14} aria-hidden="true" />
      </Link>
      <IconButton
        aria-label="Dismiss announcement"
        title={`Dismiss release v${release.version}`}
        className="docs-banner-dismiss"
        variant="ghost"
        color="fg.muted"
        size="2xs"
      >
        <X size={14} />
      </IconButton>
    </Box>
  );
}
