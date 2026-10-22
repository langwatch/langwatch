import { CommandBarSurface } from "@langwatch/design-system/app-shell";
import { DialogTitle } from "@langwatch/design-system/dialog";
import { SystemProvider } from "@langwatch/design-system/system-provider";
import { createRoot } from "react-dom/client";

import { docsIslandSystem } from "../../../app/island-theme.ts";
import { SearchContent } from "./search-content.tsx";
import { currentBuild, loadSearchIndex } from "./search-index-store.ts";

/* The index starts downloading as soon as the island runs, before the dialog first renders. */
loadSearchIndex({ build: currentBuild() }).catch(() => {});

const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
let open = false;
let opener: HTMLElement | null = null;
function closeSearch() {
  open = false;
  root.render(null);
  if (opener?.isConnected) opener.focus({ preventScroll: true });
}
function openSearch() {
  if (open) return;
  open = true;
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  root.render(
    <SystemProvider system={docsIslandSystem}>
      <CommandBarSurface open onClose={closeSearch} maxWidth="680px" topMargin="12vh">
        <DialogTitle className="docs-sr-only">Search the LangWatch docs</DialogTitle>
        <SearchContent close={closeSearch} />
      </CommandBarSurface>
    </SystemProvider>,
  );
}
document.addEventListener("click", (event) => {
  if (event.target instanceof Element && event.target.closest("[data-docs-search]")) openSearch();
});
document.addEventListener("docs:search", openSearch);
document.addEventListener("docs:leaving", closeSearch);
