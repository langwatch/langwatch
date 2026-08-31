import {
  type AvatarFallbackProps,
  Avatar as ChakraAvatar,
} from "@chakra-ui/react";
import * as React from "react";
import { firstGrapheme } from "~/utils/firstGrapheme";

/**
 * Chakra v3 Avatar wrapper. **Import the avatar from here, never from
 * `@chakra-ui/react`** — a guard test enforces it.
 *
 * The only part that differs is `Fallback`. Chakra derives initials with
 * `name.charAt(0)` on the first and last word, which in UTF-16 returns half
 * of any character outside the basic plane. Half a surrogate pair is not a
 * character, so a project named "🚩 Langy" or a person whose SSO display name
 * starts with an emoji painted a replacement box. Deriving the initials here
 * and passing them as children means Chakra's helper is never reached.
 *
 * Everything else is Chakra's, re-exported unchanged, so `<Avatar.Root>`,
 * `<Avatar.Image>` and `<Avatar.Icon>` behave exactly as before and the
 * import swap is the whole migration.
 *
 * @see specs/components/avatar-initials.feature
 */

/**
 * The one or two characters an avatar shows for `name`.
 *
 * Mirrors Chakra's own rule — first character of the first word, plus the
 * first character of the last word when there is more than one — but counts
 * in grapheme clusters rather than UTF-16 code units. Empty for a blank name,
 * which is what makes the avatar fall through to its generic icon rather than
 * render an empty bubble.
 */
export function initialsFromName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (!first) return "";
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  return last
    ? `${firstGrapheme(first)}${firstGrapheme(last)}`
    : firstGrapheme(first);
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

export const Avatar = {
  ...ChakraAvatar,
  Fallback: AvatarFallback,
};

export type {
  AvatarFallbackProps,
  AvatarIconProps,
  AvatarImageProps,
  AvatarRootProps,
} from "@chakra-ui/react";
