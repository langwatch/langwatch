import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import type { Locator } from "playwright";

import type { Action } from "./context.ts";
import { argument, asRegExp } from "./context.ts";
import { click } from "./primitives.ts";
import { targetOf } from "./target.ts";

/** FIXTURES_DIR holds the files an `upload` step attaches: tools/visualdiff/fixtures. */
const FIXTURES_DIR = join(import.meta.dirname, "..", "..", "..", "fixtures");

/** fixturePath is a fixture's file, refusing any name that climbs out of FIXTURES_DIR. */
export const fixturePath = (fixture: string): string => {
  if (fixture !== basename(fixture))
    throw new Error(`fixture "${fixture}" must be a bare file name`);
  return join(FIXTURES_DIR, fixture);
};

/** upload attaches a fixture file to a file input, visible or not (default `input[type=file]`). */
export const upload: Action = async (context) => {
  const args = { selector: "input[type=file]", ...context.args };
  await targetOf({ root: context.side.page, args, visible: false })
    .first()
    .setInputFiles(fixturePath(argument({ context, name: "fixture" })), { timeout: 6000 });
};

const centre = async (target: Locator): Promise<{ x: number; y: number }> => {
  await target.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => undefined);
  const box = await target.boundingBox({ timeout: 6000 });
  if (box === null) throw new Error("the drag's element has no box on screen");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** DRAG_STEPS moves the pointer in stages, which drag libraries need to see a drag begin. */
const DRAG_STEPS = 12;

/** dragEnd is the element a drag names: a test id in `key`, else a raw selector in
 * `${key}Selector`. */
const dragEnd = ({
  context,
  key,
}: {
  context: Parameters<Action>[0];
  key: "from" | "to";
}): Locator => {
  const selector = context.args[`${key}Selector`];
  const args: Record<string, string> =
    selector === undefined ? { testId: argument({ context, name: key }) } : { selector };
  return targetOf({ root: context.side.page, args }).first();
};

/** drag holds the `from` element and releases it over the `to` element (test ids, or
 * `fromSelector`/`toSelector`). */
export const drag: Action = async (context) => {
  const { page } = context.side;
  const start = await centre(dragEnd({ context, key: "from" }));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const end = await centre(dragEnd({ context, key: "to" }));
  await page.mouse.move(end.x, end.y, { steps: DRAG_STEPS });
  await page.mouse.up();
};

/** textOf reads what a person sees in an element: a field's value, else its text. */
const textOf = async (target: Locator): Promise<string> =>
  target.evaluate(
    (node) =>
      node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement
        ? node.value
        : (node.textContent ?? ""),
    undefined,
    { timeout: 6000 },
  );

/**
 * capture stores an element's text as `{as}` for the steps after it (a minted secret, a share URL).
 * `match` is a regular expression whose first match, or first group, is what is kept.
 */
export const capture: Action = async (context) => {
  const target = targetOf({ root: context.side.page, args: context.args }).first();
  await target.waitFor({ state: "visible", timeout: 6000 });
  const text = (await textOf(target)).trim();
  const pattern = context.args.match;
  const found = pattern === undefined ? [text] : new RegExp(pattern).exec(text);
  const kept = found?.[1] ?? found?.[0];
  if (kept === undefined || kept === "")
    throw new Error(
      `capture ${argument({ context, name: "as" })}: nothing to keep in "${text.slice(0, 60)}"`,
    );
  context.values[argument({ context, name: "as" })] = kept;
};

/**
 * download clicks the named control and waits for the file the page saves: `contains` must be in
 * its text (a CSV header row) and `filename`, when given, must match the suggested name.
 */
export const download: Action = async (context) => {
  const [file] = await Promise.all([
    context.side.page.waitForEvent("download", { timeout: Number(context.args.timeout ?? 15_000) }),
    click(context),
  ]);
  const path = await file.path();
  const text = await readFile(path, "utf8");
  const wanted = context.args.contains;
  if (wanted !== undefined && !text.includes(wanted)) {
    throw new Error(
      `download ${file.suggestedFilename()} lacks "${wanted}": starts "${text.slice(0, 80)}"`,
    );
  }
  const wantedName = context.args.filename;
  const name = file.suggestedFilename();
  if (wantedName !== undefined && !asRegExp(wantedName).test(name)) {
    throw new Error(`download is named ${name}, want ${wantedName}`);
  }
};

/** hover puts the pointer over the named element, for controls only a group hover reveals. */
export const hover: Action = async (context) => {
  await targetOf({ root: context.side.page, args: context.args }).first().hover({ timeout: 6000 });
};
