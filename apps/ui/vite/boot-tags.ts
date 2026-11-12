/**
 * Marks the script and stylesheet tags the build writes into `index.html` as the application's
 * own. The boot recovery in `index.html` reloads only for a marked tag, so a tag an edge or a
 * proxy adds is never retried, whatever its URL looks like.
 */
import type { Plugin } from "vite";

/** The attribute the boot recovery in `index.html` reads; keep the two spellings equal. */
export const BOOT_TAG_ATTRIBUTE = "data-lw-boot";

const ASSET_TAG = /<(script|link)\b([^>]*?\s(?:src|href)="[^"]*\/assets\/[^"]*"[^>]*)>/g;

/** Adds the marker to every script or link tag that loads a built asset file. */
export function markBootTags({ html }: { html: string }): string {
  return html.replace(ASSET_TAG, (tag: string, name: string, rest: string) =>
    rest.includes(BOOT_TAG_ATTRIBUTE) ? tag : `<${name} ${BOOT_TAG_ATTRIBUTE}${rest}>`,
  );
}

export function bootTags(): Plugin {
  return {
    name: "langwatch:boot-tags",
    apply: "build",
    // After Vite has written the entry, its preloads and its stylesheet into the page.
    transformIndexHtml: { order: "post", handler: (html) => markBootTags({ html }) },
  };
}
