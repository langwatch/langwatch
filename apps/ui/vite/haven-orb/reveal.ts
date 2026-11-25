/** The orb's own top stacking context: no app overlay or fixed layer draws over or swallows it. */
export function orbShell({ doc }: { doc: Document }): HTMLElement {
  const shell = doc.createElement("div");
  shell.setAttribute("data-haven-orb", "");
  shell.style.cssText = "position:fixed;top:0;left:0;z-index:2147483647";
  doc.body.append(shell);
  return shell;
}

/** Calls `onPainted` once the app renders into #root: the orb never floats over a blank page. */
export function whenAppPainted({ doc, onPainted }: { doc: Document; onPainted: () => void }): void {
  const root = doc.getElementById("root");
  if (!root || root.childElementCount > 0) return onPainted();
  const watch = new MutationObserver(() => {
    if (root.childElementCount === 0) return;
    watch.disconnect();
    onPainted();
  });
  watch.observe(root, { childList: true });
}
