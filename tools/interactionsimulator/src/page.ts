import type { PlanStep } from "@langwatch/visual-diff-runner/src/protocol";
import type { Page } from "playwright";
import { z } from "zod";

/** Candidate is one control jev may choose: its role and accessible name, under a short id. */
type AriaRole = Parameters<Page["getByRole"]>[0];

export interface Candidate {
  id: string;
  role: AriaRole;
  name: string;
}

const INTERACTIVE: readonly AriaRole[] = [
  "button",
  "link",
  "textbox",
  "searchbox",
  "combobox",
  "checkbox",
  "radio",
  "switch",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "option",
  "spinbutton",
  "slider",
  "treeitem",
];

const isInteractive = (role: string): role is AriaRole =>
  INTERACTIVE.some((known) => known === role);

const TYPED = new Set(["textbox", "searchbox", "spinbutton"]);

const NODE = /^(\s*)- ([a-z]+) "((?:[^"\\]|\\.)*)"/;

/** PAGE_BUDGET bounds the tree jev reads; jev cuts to its own budget too, this keeps it small. */
const PAGE_BUDGET = 8_000;

const unquote = (raw: string): string => {
  try {
    return z
      .string()
      .catch(raw)
      .parse(JSON.parse(`"${raw}"`));
  } catch {
    return raw;
  }
};

/** focus is the topmost open dialog's subtree when one is open, as a user's attention is. */
const focus = (aria: string): string[] => {
  const lines = aria.split("\n");
  const start = lines.findLastIndex((line) => /^\s*- (dialog|alertdialog)\b/.test(line));
  if (start < 0) return lines;
  const indent = (lines[start] ?? "").search(/\S/);
  const end = lines.findIndex(
    (line, index) => index > start && line.trim() !== "" && line.search(/\S/) <= indent,
  );
  return lines.slice(start, end < 0 ? undefined : end);
};

/** pageSummary is the trimmed accessibility tree jev reads for one step. */
export const pageSummary = (aria: string): string => focus(aria).join("\n").slice(0, PAGE_BUDGET);

/** candidatesOf lists the named controls in focus, each once, as e1..eN. */
export const candidatesOf = ({
  aria,
  limit = 60,
}: {
  aria: string;
  limit?: number;
}): Candidate[] => {
  const seen = new Set<string>();
  const found: Candidate[] = [];
  for (const line of focus(aria)) {
    const match = NODE.exec(line);
    const role = match?.[2] ?? "";
    if (!isInteractive(role)) continue;
    const name = unquote(match?.[3] ?? "");
    if (name.trim() === "" || seen.has(`${role}\n${name}`)) continue;
    seen.add(`${role}\n${name}`);
    found.push({ id: `e${found.length + 1}`, role, name });
    if (found.length === limit) break;
  }
  return found;
};

/** actionFor keeps jev's action where the role allows it, and the role's own action otherwise. */
export const actionFor = ({
  role,
  chosen,
}: {
  role: string;
  chosen: string;
}): "click" | "fill" | "select" => {
  if (TYPED.has(role)) return "fill";
  if (role === "combobox") return chosen === "fill" ? "fill" : "select";
  return "click";
};

/**
 * perform carries out one action and answers it as a visualdiff flow step:
 * by test id where the element has one, by its role and exact name otherwise.
 * `{uid}` in a value is this run's; the step keeps the placeholder.
 */
export const perform = async ({
  page,
  candidate,
  action,
  value,
  uid,
}: {
  page: Page;
  candidate: Candidate;
  action: "click" | "fill" | "select";
  value: string;
  uid: string;
}): Promise<PlanStep> => {
  const target = page.getByRole(candidate.role, { name: candidate.name, exact: true }).first();
  const testId = await target.getAttribute("data-testid", { timeout: 3_000 }).catch(() => null);
  const named: Record<string, string> =
    testId === null
      ? { selector: `role=${candidate.role}[name=${JSON.stringify(candidate.name)}s]` }
      : { testId };
  const typed = value.replaceAll("{uid}", uid);
  if (action === "fill") {
    await target.fill(typed, { timeout: 6_000 });
    return { action: "fill", with: { ...named, value } };
  }
  if (action === "select") {
    const native = await target.evaluate((node) => node.tagName === "SELECT", undefined, {
      timeout: 6_000,
    });
    if (native) {
      await target.selectOption({ label: typed }, { timeout: 6_000 });
    } else {
      await target.click({ timeout: 6_000 });
      await page.getByRole("option", { name: typed }).first().click({ timeout: 6_000 });
    }
    return { action: "select", with: { ...named, option: value } };
  }
  await target.scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => undefined);
  await target.click({ timeout: 6_000 });
  return { action: "click", with: named };
};
