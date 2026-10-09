import { Badge } from "@chakra-ui/react";
import { createContext, type ReactNode, useContext } from "react";

/**
 * Whether the screen has already said, once and in full, that what is on it is
 * invented.
 *
 * True while the amber sample banner is up. The banner is a sentence across the
 * top of the page saying nothing below it is real, so a badge on each panel
 * underneath repeats it — and on a screen where every panel is invented that is
 * sixteen repetitions of a fact the reader accepted at the first one. Sixteen
 * grey badges do not make the point sixteen times. They become furniture, and
 * furniture is what a reader stops seeing.
 */
const SampleAlreadySaid = createContext(false);

/**
 * Declares that the banner is up, so the marks below may stand down.
 *
 * Wrap the page content, not the banner itself.
 */
export function SampleSaidOnce({
  said,
  children,
}: {
  said: boolean;
  children: ReactNode;
}) {
  return (
    <SampleAlreadySaid.Provider value={said}>
      {children}
    </SampleAlreadySaid.Provider>
  );
}

/**
 * The `sample` mark on one panel or lane.
 *
 * One component for every surface on the page, so a lane can never carry a
 * different badge from a panel: the reader learns the mark once, on whichever
 * they look at first.
 *
 * THE SUPPRESSION IS NOT COSMETIC, AND ITS LIMIT IS THE WHOLE POINT. The mark
 * disappears only when something louder is already saying the same thing for
 * the entire screen. It stays wherever it is the only thing saying it — a panel
 * drawing invented figures while the rest of the page draws measured ones has
 * no banner over it, and an unmarked invented figure in the house typeface is
 * indistinguishable from the organization's own money. That case is the reason
 * the badge exists, and it is untouched here.
 *
 * So: never render a mark the banner already made, and never drop one the
 * banner did not.
 */
export function SampleMark({ shown }: { shown?: boolean }) {
  const alreadySaid = useContext(SampleAlreadySaid);
  if (!shown || alreadySaid) return null;
  return (
    <Badge size="xs" variant="subtle" colorPalette="gray">
      sample
    </Badge>
  );
}
