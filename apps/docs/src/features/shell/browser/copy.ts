import { sitePath } from "../../../lib/site-path.ts";

async function fetchText({ path }: { path: string }) {
  const response = await fetch(sitePath({ path }), { credentials: "omit" });
  if (!response.ok) throw new Error("Copy source unavailable");
  return response.text();
}

/** A code button reads the block it sits in: the selected tab of a group, else its only block. */
function blockCode({ button }: { button: HTMLButtonElement }) {
  const response = button
    .closest("section")
    ?.querySelector<HTMLElement>("[data-response-status]:not([hidden]) .docs-code-region");
  const frame = button.closest(".docs-code-frame");
  const tabs = button.closest('[data-scope="tabs"][data-part="root"]');
  const visible = '[role="tabpanel"]:not([hidden]) .docs-code-region';
  const region =
    response ??
    frame?.querySelector<HTMLElement>(visible) ??
    frame?.querySelector<HTMLElement>(".docs-code-region") ??
    tabs?.querySelector<HTMLElement>(visible);
  return region?.dataset.code ?? "";
}

function copyText({ button }: { button: HTMLButtonElement }): string | Promise<string> {
  const agent = button.closest(".docs-agent-launcher")?.querySelector<HTMLSelectElement>("select");
  if (agent) return `npx langwatch ${agent.value}`;
  const slug = button.dataset.docsPageCopy;
  if (slug) return fetchText({ path: `/${slug}.md` });
  const file = button.dataset.docsCopyFile;
  if (file) return fetchText({ path: `/${file}` });
  if (button.hasAttribute("data-docs-prompt"))
    return button.closest(".docs-agent-start")?.querySelector("pre")?.textContent ?? "";
  return button.dataset.docsCopyPrompt || button.dataset.docsCopy || blockCode({ button });
}

/**
 * Fetched text goes through a promised clipboard item, so the click still counts as the
 * gesture.
 */
async function writeClipboard({ text }: { text: string | Promise<string> }) {
  if (typeof text !== "string" && typeof ClipboardItem === "function") {
    const blob = text.then((value) => new Blob([value], { type: "text/plain" }));
    blob.catch(() => {});
    try {
      return await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
    } catch {
      /* Fall back to plain text below. */
    }
  }
  await navigator.clipboard.writeText(await text);
}

async function copy({ button }: { button: HTMLButtonElement }) {
  const original = button.innerHTML;
  const label = button.getAttribute("aria-label");
  const output =
    button.closest(".docs-agent-start, .docs-agent-launcher")?.querySelector("output") ??
    button.parentElement?.querySelector("output");
  try {
    await writeClipboard({ text: copyText({ button }) });
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
