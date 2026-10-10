import {
  type AvatarFallbackProps,
  Avatar as ChakraAvatar,
  type AvatarRootProps,
} from "@chakra-ui/react";
import * as React from "react";

import { firstGrapheme } from "../../first-grapheme.ts";

/** Chakra v3 Avatar wrapper (import from here, not @chakra-ui/react); custom Fallback for
 * grapheme-aware initials (emoji-safe); see avatar-initials.feature */

/** Initials from name (first and last word's first grapheme); empty for blank name (falls
 * through to icon rather than empty bubble) */
export function initialsFromName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (!first) return "";
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  return last ? `${firstGrapheme(first)}${firstGrapheme(last)}` : firstGrapheme(first);
}

const AvatarFallback = React.forwardRef<HTMLDivElement, AvatarFallbackProps>(
  function AvatarFallback({ name, children, ...rest }, ref) {
    // A caller that passes its own content has already chosen what the bubble
    // says (ProjectAvatar picks a single character on purpose), so nothing is
    // derived for it.
    const derived = children ?? (name ? initialsFromName(name) : undefined);
    // An empty result becomes no children at all, so Chakra falls through to
    // its generic icon rather than rendering an empty bubble. `name` is
    // deliberately not forwarded either: left on, Chakra would re-derive the
    // initials with charAt(0) — the exact bug this wrapper exists for.
    const content = derived === "" ? undefined : derived;

    return (
      <ChakraAvatar.Fallback ref={ref} {...rest}>
        {content}
      </ChakraAvatar.Fallback>
    );
  },
);

/** Same-hue light: lighter top-left easing into the avatar's own colour. */
const AVATAR_SHEEN =
  "linear-gradient(135deg, rgba(255, 255, 255, 0.28) 0%, rgba(255, 255, 255, 0.06) 55%, transparent 100%)";

/** The hue a style prop names: a token like "cyan.400" becomes its CSS variable. */
function hueOf(props: AvatarRootProps): string {
  const named = props.background ?? props.backgroundColor ?? props.bg;
  if (typeof named !== "string") return "var(--chakra-colors-color-palette-solid)";
  return /^[a-z]+\.\d+$/.test(named) ? `var(--chakra-colors-${named.replace(".", "-")})` : named;
}

type AvatarRootExtras = { lifted?: boolean };

/** Projects and orgs get the sheen only; people (`lifted`) add a rim and a tinted shadow. */
const AvatarRoot = React.forwardRef<HTMLDivElement, AvatarRootProps & AvatarRootExtras>(
  function AvatarRoot({ lifted, ...props }, ref) {
    const hue = hueOf(props);
    const lift = lifted
      ? {
          boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${hue} 70%, black 30%), 0 1px 3px color-mix(in srgb, ${hue} 45%, transparent)`,
        }
      : {};
    return (
      <ChakraAvatar.Root
        ref={ref}
        backgroundImage={AVATAR_SHEEN}
        data-lifted={lifted ? "" : undefined}
        {...lift}
        {...props}
      />
    );
  },
);

export const Avatar: typeof ChakraAvatar = {
  ...ChakraAvatar,
  Root: AvatarRoot,
  Fallback: AvatarFallback,
};

/** Initials once the URL fails; tracks the URL so a new photo is not stuck on an old failure. */
function UserAvatarPhoto({ src }: { src: string | null }) {
  const [brokenUrl, setBrokenUrl] = React.useState<string | null>(null);
  if (!src || src === brokenUrl) return null;
  return <Avatar.Image src={src} onError={() => setBrokenUrl(src)} />;
}

/** A person: photo from `src`, else initials from `name`. Never fetches; caller resolves `src`. */
export function UserAvatar({
  name,
  src,
  ...rootProps
}: Omit<AvatarRootProps, "children"> & { name?: string | null; src?: string | null }) {
  return (
    <AvatarRoot lifted {...rootProps}>
      <UserAvatarPhoto src={src ?? null} />
      <Avatar.Fallback name={name ?? void 0} />
    </AvatarRoot>
  );
}

export type {
  AvatarFallbackProps,
  AvatarIconProps,
  AvatarImageProps,
  AvatarRootProps,
} from "@chakra-ui/react";
