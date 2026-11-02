import { slide } from "../../../lib/slide.ts";
import { generateExample, paramKey } from "../model/codegen.ts";
import type { RequestState } from "../model/codegen.ts";
import { EXAMPLE_LANGUAGES } from "../model/operation.ts";
import type { Operation } from "../model/operation.ts";
import { errorFieldId } from "../model/request-validation.ts";

export function fieldValue({ id }: { id: string }) {
  const field = document.getElementById(id);
  return field instanceof HTMLInputElement ||
    field instanceof HTMLTextAreaElement ||
    field instanceof HTMLSelectElement
    ? field.value
    : "";
}

export function requestState({ operation }: { operation: Operation }): RequestState {
  return {
    values: Object.fromEntries(
      operation.parameters.map((param) => [
        paramKey({ location: param.in, name: param.name }),
        fieldValue({ id: `pg-${param.in}-${param.name}` }),
      ]),
    ),
    body: fieldValue({ id: "pg-body" }),
  };
}

export function updateExamples({ operation }: { operation: Operation }) {
  const state = requestState({ operation });
  const panel = document.querySelector('section[aria-label="Request example"]');
  const regions = panel?.querySelectorAll<HTMLElement>(".docs-code-region");
  EXAMPLE_LANGUAGES.forEach((entry, index) => {
    const region = regions?.[index];
    if (!region) return;
    const code = generateExample({ operation, state, language: entry.id });
    region.dataset.code = code;
    const content = region.querySelector("code");
    if (content) content.textContent = code;
  });
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
    field?.insertAdjacentElement("afterend", note);
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
