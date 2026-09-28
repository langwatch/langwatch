import { InlineCommandPalette } from "../../../../behavior/lent-peers.tsx";

/** The landing hero's ask field: navigation's palette, inline; shared by home and governance. */
export function HeroAskField({ placeholder }: { placeholder: string }) {
  return <InlineCommandPalette placeholder={placeholder} />;
}
