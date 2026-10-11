async function copyText({ button }: { button: HTMLButtonElement }) {
  const slug = button.dataset.docsPageCopy;
  if (slug) {
    const response = await fetch(`/${slug}.md`, { credentials: "omit" });
    if (!response.ok) throw new Error("Markdown unavailable");
    return response.text();
  }
  if (button.hasAttribute("data-docs-prompt"))
    return button.closest(".docs-agent-start")?.querySelector("pre")?.textContent ?? "";
  const tabs = button.closest('[data-scope="tabs"][data-part="root"]');
  const selected = tabs?.querySelector<HTMLElement>(
    '[role="tabpanel"]:not([hidden]) .docs-code-region',
  );
  const response = button
    .closest("section")
    ?.querySelector<HTMLElement>("[data-response-status]:not([hidden]) .docs-code-region");
  return response?.dataset.code ?? selected?.dataset.code ?? button.dataset.docsCopy ?? "";
}

async function copy({ button }: { button: HTMLButtonElement }) {
  const original = button.innerHTML;
  const label = button.getAttribute("aria-label");
  const output =
    button.closest(".docs-agent-start")?.querySelector("output") ??
    button.parentElement?.querySelector("output");
  try {
    await navigator.clipboard.writeText(await copyText({ button }));
    if (label) button.setAttribute("aria-label", "Copied");
    else button.textContent = button.hasAttribute("data-docs-prompt") ? "Prompt copied" : "Copied";
    button.dataset.copied = "true";
    if (output)
      output.textContent = button.hasAttribute("data-docs-prompt")
        ? "Copied. Paste into your agent to start tracing."
        : "Copied to clipboard";
    setTimeout(() => {
      delete button.dataset.copied;
      button.innerHTML = original;
      if (label) button.setAttribute("aria-label", label);
    }, 2000);
  } catch {
    if (output)
      output.textContent = button.hasAttribute("data-docs-prompt")
        ? "Copy failed. Open the skills directory to select the full prompt."
        : "Could not copy. Select the text instead.";
  }
}

export function installCopyControls() {
  document.addEventListener("click", (event) => {
    const button =
      event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>(
            "[data-docs-copy], [data-docs-page-copy], [data-docs-prompt]",
          )
        : null;
    if (button) void copy({ button });
  });
}

installCopyControls();
