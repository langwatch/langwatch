import { slide } from "../../../lib/slide.ts";
import { jsonTokens } from "../model/json-tokens.ts";
import { errorFieldId } from "../model/request-validation.ts";

export function fieldValue({ id }: { id: string }) {
  const field = document.getElementById(id);
  if (field?.getAttribute("role") === "radiogroup")
    return field.querySelector<HTMLInputElement>("input:checked")?.value ?? "";
  return field instanceof HTMLInputElement ||
    field instanceof HTMLTextAreaElement ||
    field instanceof HTMLSelectElement
    ? field.value
    : "";
}

export function showErrors({ errors }: { errors: Record<string, string> }) {
  document.querySelectorAll("[data-request-error]").forEach((node) => node.remove());
  document
    .querySelectorAll('#try-it-form [aria-invalid="true"]')
    .forEach((node) => node.removeAttribute("aria-invalid"));
  for (const [key, message] of Object.entries(errors)) {
    const field = document.getElementById(errorFieldId({ first: key }));
    field?.setAttribute("aria-invalid", "true");
    const note = document.createElement("p");
    note.dataset.requestError = "";
    note.id = `${field?.id}-error`;
    note.className = "docs-request-error";
    note.textContent = message;
    field?.setAttribute("aria-describedby", note.id);
    /* A field inside a group (the key's reveal button, the body's coloured copy) notes under it. */
    (field?.closest("[data-docs-error-after]") ?? field)?.insertAdjacentElement("afterend", note);
  }
  const first = Object.keys(errors)[0];
  if (first) document.getElementById(errorFieldId({ first }))?.focus();
}

export function setFormOpen({ open }: { open: boolean }) {
  const form = document.querySelector<HTMLElement>("[data-docs-form]");
  if (form) slide({ panel: form, open });
  document.getElementById("try-it-button")?.setAttribute("aria-expanded", String(open));
  if (open) {
    form?.scrollIntoView({ block: "nearest" });
    form?.querySelector<HTMLElement>("input,select,textarea")?.focus({ preventScroll: true });
  } else document.getElementById("try-it-button")?.focus();
}

export function editManualKey({ action }: { action: string }) {
  const input = document.getElementById("pg-auth");
  if (!(input instanceof HTMLInputElement)) return;
  if (action === "Clear") input.value = "";
  else {
    input.type = input.type === "password" ? "text" : "password";
    document
      .querySelector('#try-it-form button[aria-label$="key"]')
      ?.setAttribute("aria-label", input.type === "password" ? "Reveal key" : "Hide key");
  }
}

/** Recolours the body editor's copy after an edit and grows the field where CSS cannot. */
export function syncBody() {
  const field = document.getElementById("pg-body");
  const mirror = document.querySelector<HTMLElement>("[data-docs-body-mirror]");
  if (!(field instanceof HTMLTextAreaElement) || !mirror) return;
  const runs = jsonTokens({ text: field.value }).map((token) => {
    if (token.kind === "plain") return document.createTextNode(token.text);
    const run = document.createElement("span");
    run.className = `docs-json-${token.kind}`;
    run.textContent = token.text;
    return run;
  });
  mirror.replaceChildren(...runs, document.createTextNode("\u200b"));
  if (CSS.supports("field-sizing", "content")) return;
  field.style.height = "auto";
  field.style.height = `${field.scrollHeight}px`;
}
