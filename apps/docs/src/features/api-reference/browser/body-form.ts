import { bodyFormOf } from "../model/body-form.ts";
import { bodyFormEntries, readBodyForm, type FormEntries } from "../model/body-value.ts";
import type { Operation } from "../model/operation.ts";
import { showErrors, syncBody } from "./playground-dom.ts";

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
let nextRow = 0;

const editor = () => document.querySelector<HTMLElement>("[data-body-mode]");
const formRoot = () => document.querySelector<HTMLElement>("[data-body-form]");
const controls = () => [...(formRoot()?.querySelectorAll<Control>("[data-body-field]") ?? [])];

export function bodyMode(): "form" | "json" {
  return editor()?.dataset.bodyMode === "form" ? "form" : "json";
}

function formEntries(): FormEntries {
  const entries: FormEntries = {};
  for (const control of controls()) {
    const key = control.dataset.bodyField ?? "";
    if (control instanceof HTMLInputElement && control.type === "radio" && !control.checked)
      continue;
    const raw =
      control instanceof HTMLInputElement && control.type === "checkbox"
        ? String(control.checked)
        : control.value;
    (entries[key] ??= []).push(raw);
  }
  return entries;
}

function extraOf(): Record<string, unknown> {
  try {
    return JSON.parse(formRoot()?.dataset.bodyExtra ?? "{}");
  } catch {
    return {};
  }
}

/** The form's body and what keeps it from being sent; null outside form mode. */
export function readForm({ operation }: { operation: Operation }) {
  const form = bodyFormOf({ operation });
  if (!form || bodyMode() !== "form") return null;
  return readBodyForm({ form, entries: formEntries(), extra: extraOf() });
}

/** Writes the form's value into the JSON editor, the one body every example and Send reads. */
export function syncFormToBody({ operation }: { operation: Operation }) {
  const read = readForm({ operation });
  const field = document.getElementById("pg-body");
  if (!read || !(field instanceof HTMLTextAreaElement)) return;
  field.value = read.body;
  syncBody();
}

/** Numbers each row's labels after an Add or a Remove. */
function renumber({ list }: { list: HTMLElement }) {
  const name = list.dataset.bodyName ?? "";
  list.querySelectorAll<HTMLElement>("[data-body-rows] > [data-body-row]").forEach((row, index) => {
    const label = `${name} item ${index + 1}`;
    row.querySelector("[data-body-field], [role=radiogroup]")?.setAttribute("aria-label", label);
    row.querySelector("[data-body-remove]")?.setAttribute("aria-label", `Remove ${label}`);
  });
}

function addRow({ list }: { list: HTMLElement }) {
  const template = list.querySelector<HTMLTemplateElement>("template[data-body-row-template]");
  const rows = list.querySelector("[data-body-rows]");
  if (!template || !rows) return null;
  const holder = document.createElement("div");
  holder.innerHTML = template.innerHTML.replaceAll("__row__", `n${nextRow++}`);
  const row = holder.firstElementChild;
  if (row) rows.append(row);
  renumber({ list });
  return row;
}

function fillForm({ entries }: { entries: FormEntries }) {
  for (const list of formRoot()?.querySelectorAll<HTMLElement>("[data-body-list]") ?? []) {
    list.querySelectorAll("[data-body-rows] > [data-body-row]").forEach((row) => row.remove());
    for (const _ of entries[list.dataset.bodyList ?? ""] ?? []) addRow({ list });
  }
  const used: Record<string, number> = {};
  for (const control of controls()) {
    const key = control.dataset.bodyField ?? "";
    if (control instanceof HTMLInputElement && control.type === "radio") {
      control.checked = control.value === (entries[key]?.[0] ?? "");
      continue;
    }
    const index = (used[key] = (used[key] ?? -1) + 1);
    const value = entries[key]?.[index] ?? "";
    if (control instanceof HTMLInputElement && control.type === "checkbox")
      control.checked = value === "true";
    else control.value = value;
  }
}

function showMode({ mode }: { mode: "form" | "json" }) {
  const root = editor();
  if (!root) return;
  root.dataset.bodyMode = mode;
  root.querySelectorAll<HTMLElement>("[data-body-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.bodyPanel !== mode;
  });
  root.querySelectorAll("[data-body-mode-button]").forEach((button) => {
    button.setAttribute(
      "aria-pressed",
      String(button.getAttribute("data-body-mode-button") === mode),
    );
  });
}

/**
 * Switches the body between the form and JSON. JSON shows the form's value; the form takes the
 * JSON back, and JSON it cannot read or show keeps the reader in JSON with the reason.
 */
export function setBodyMode({ operation, mode }: { operation: Operation; mode: "form" | "json" }) {
  const form = bodyFormOf({ operation });
  if (!form || mode === bodyMode()) return;
  if (mode === "json") {
    const read = readForm({ operation });
    /* An empty required field can be filled in JSON just as well; only a broken value blocks. */
    const blocking = Object.entries(read?.errors ?? {}).filter(
      ([key]) => !read?.unfilled.includes(key),
    );
    if (blocking.length) return showErrors({ errors: Object.fromEntries(blocking) });
    syncFormToBody({ operation });
    showErrors({ errors: {} });
    showMode({ mode });
    return;
  }
  const text = (document.getElementById("pg-body") as HTMLTextAreaElement | null)?.value ?? "";
  const parsed = bodyFormEntries({ form, text });
  if (!parsed.ok) return showErrors({ errors: { body: parsed.reason } });
  showErrors({ errors: {} });
  fillForm({ entries: parsed.entries });
  const root = formRoot();
  if (root) {
    if (Object.keys(parsed.extra).length) root.dataset.bodyExtra = JSON.stringify(parsed.extra);
    else delete root.dataset.bodyExtra;
  }
  showMode({ mode });
  syncFormToBody({ operation });
}

/** Add and Remove on a list of values; true when the click was one of them. */
export function editRows({ button }: { button: Element }) {
  const list = button.closest<HTMLElement>("[data-body-list]");
  if (!list) return false;
  if (button.hasAttribute("data-body-add")) {
    addRow({ list })?.querySelector<HTMLElement>("input, select, textarea")?.focus();
    return true;
  }
  if (!button.hasAttribute("data-body-remove")) return false;
  const row = button.closest("[data-body-row]");
  const rows = [...list.querySelectorAll("[data-body-rows] > [data-body-row]")];
  const next = rows[rows.indexOf(row as Element) + 1] ?? rows[rows.indexOf(row as Element) - 1];
  row?.remove();
  renumber({ list });
  (
    next?.querySelector<HTMLElement>("[data-body-remove]") ??
    list.querySelector<HTMLElement>("[data-body-add]")
  )?.focus();
  return true;
}
