import { type AvatarFallbackProps, Avatar as ChakraAvatar } from "@chakra-ui/react";
import * as React from "react";

import { firstGrapheme } from "../first-grapheme.ts";

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

export const Avatar: typeof ChakraAvatar = {
  ...ChakraAvatar,
  Fallback: AvatarFallback,
};

export type {
  AvatarFallbackProps,
  AvatarIconProps,
  AvatarImageProps,
  AvatarRootProps,
} from "@chakra-ui/react";
