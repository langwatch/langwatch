import { GitHubIcon, Python, TypeScript } from "@langwatch/design-system/icons";
import { Box, Image } from "@langwatch/design-system/primitives";

import { GenericIcon, ICONS } from "../../../lib/icon-registry.tsx";

const BRAND_ICONS = { github: GitHubIcon, python: Python, typescript: TypeScript };

type IconProps = { icon?: string; size?: number | string };

/** Resolves a Font Awesome name to a bundled glyph, or an asset path to its local image. */
export function Icon({ icon, size = 20 }: IconProps) {
  const pixels = typeof size === "number" ? size : Number.parseInt(size, 10) || 20;
  if (icon && /^(\/|https?:)/.test(icon)) {
    return (
      <Image
        src={icon}
        alt=""
        width={`${pixels}px`}
        height={`${pixels}px`}
        flexShrink={0}
        objectFit="contain"
        css={{ display: "inline-block" }}
      />
    );
  }
  const Brand = Object.entries(BRAND_ICONS).find(([name]) => name === icon)?.[1];
  if (Brand) {
    return (
      <Box
        as="span"
        display="inline-flex"
        flexShrink={0}
        width={`${pixels}px`}
        height={`${pixels}px`}
        aria-hidden="true"
        css={{ "& svg": { width: "100%", height: "100%" } }}
      >
        <Brand />
      </Box>
    );
  }
  const Glyph = (icon && ICONS[icon]) || GenericIcon;
  return (
    <Box as="span" display="inline-flex" flexShrink={0} color="inherit" aria-hidden="true">
      <Glyph size={pixels} strokeWidth={1.8} />
    </Box>
  );
}
