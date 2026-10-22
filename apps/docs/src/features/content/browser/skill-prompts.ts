import { PROMPT_FRAGMENT_ATTRIBUTE as FRAGMENT_ATTRIBUTE } from "../ui/prompt-attributes.ts";

/** Replaces the preview with the rendered body once; a failed fetch is retried on the next open. */
async function fill({ details }: { details: HTMLDetailsElement }) {
  const body = details.querySelector<HTMLElement>(`[${FRAGMENT_ATTRIBUTE}]`);
  const href = body?.getAttribute(FRAGMENT_ATTRIBUTE);
  if (!body || !href) return;
  body.removeAttribute(FRAGMENT_ATTRIBUTE);
  try {
    const response = await fetch(href, { credentials: "omit" });
    if (!response.ok) throw new Error("Prompt fragment unavailable");
    body.innerHTML = await response.text();
    /* The bootstrap enabled the page's copy buttons before this markup existed. */
    body.querySelectorAll<HTMLButtonElement>("[data-docs-copy]").forEach((button) => {
      button.disabled = false;
    });
  } catch {
    body.setAttribute(FRAGMENT_ATTRIBUTE, href);
  }
}

/** Fills every prompt already open: the click that loaded this script opened one before it ran. */
export function fillOpenPrompts() {
  document
    .querySelectorAll<HTMLDetailsElement>("details.docs-skill-prompt[open]")
    .forEach((details) => void fill({ details }));
}

/* `toggle` does not bubble, so the document listens in the capture phase. */
document.addEventListener(
  "toggle",
  (event) => {
    const details = event.target;
    if (details instanceof HTMLDetailsElement && details.open) void fill({ details });
  },
  true,
);
fillOpenPrompts();
