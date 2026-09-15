import type { Action, ActionContext } from "./context";
import { argument, asRegExp, fillPath, scope } from "./context";

const CLICKABLE =
  "button, a, [role=button], [role=menuitem], [role=tab], [role=option], [role=radio]";

export const goTo = async ({
  context,
  path,
}: {
  context: ActionContext;
  path: string;
}): Promise<void> => {
  const { side, slug } = context;
  await side.page.goto(side.baseUrl + fillPath({ path, slug }), {
    waitUntil: "commit",
    timeout: 20_000,
  });
  await side.page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
};

export const clickText = async ({
  context,
  text,
  selector,
  optional,
}: {
  context: ActionContext;
  text: string;
  selector?: string;
  optional?: boolean;
}): Promise<void> => {
  const root = await scope(context.side.page);
  const pattern = asRegExp(text);
  let target = root
    .locator(selector ?? CLICKABLE)
    .filter({ hasText: pattern })
    .locator("visible=true")
    .first();
  if ((await target.count().catch(() => 0)) === 0) {
    target = root.getByText(pattern).locator("visible=true").first();
  }
  if (optional === true && (await target.count().catch(() => 0)) === 0) return;
  await target.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => undefined);
  await target.click({ timeout: 6000 });
};

export const fillField = async ({
  context,
  target,
  value,
}: {
  context: ActionContext;
  target: string;
  value: string;
}): Promise<void> => {
  const root = await scope(context.side.page);
  const pattern = asRegExp(target);
  const attempts = [
    () => root.getByPlaceholder(pattern).locator("visible=true").first(),
    () => root.getByLabel(pattern).locator("visible=true").first(),
    () =>
      root
        .locator(`input[name="${target}"], textarea[name="${target}"]`)
        .locator("visible=true")
        .first(),
  ];
  for (const attempt of attempts) {
    const field = attempt();
    if ((await field.count().catch(() => 0)) > 0) {
      await field.fill(value, { timeout: 6000 });
      return;
    }
  }
  throw new Error(`no field matching ${target}`);
};

export const go: Action = async (context) =>
  goTo({ context, path: argument({ context, name: "path" }) });

export const click: Action = async (context) =>
  clickText({
    context,
    text: argument({ context, name: "text" }),
    selector: context.args.selector,
    optional: context.args.optional === "true",
  });

export const fill: Action = async (context) =>
  fillField({
    context,
    target: argument({ context, name: "field" }),
    value: argument({ context, name: "value" }),
  });

export const select: Action = async (context) => {
  const root = await scope(context.side.page);
  await root
    .locator("select")
    .locator("visible=true")
    .first()
    .selectOption({ label: argument({ context, name: "option" }) }, { timeout: 6000 });
};

/** type puts text into a placeholder-identified box and optionally submits it. */
export const type: Action = async (context) => {
  const { side } = context;
  const box = side.page
    .getByPlaceholder(asRegExp(argument({ context, name: "placeholder" })))
    .first();
  await box.click({ timeout: 6000 });
  await side.page.keyboard.type(argument({ context, name: "text" }), { delay: 12 });
  if (context.args.submit === "true") await side.page.keyboard.press("Enter");
};

export const wait: Action = async (context) => {
  await context.side.page.waitForTimeout(
    Number(argument({ context, name: "millis", fallback: "500" })),
  );
};

/** dismissTour clears the product tour, which otherwise covers every screen behind it. */
export const dismissTour: Action = async (context) => {
  for (const label of ["Skip tour", "Skip", "Got it", "Dismiss"]) {
    const button = context.side.page.getByRole("button", { name: label, exact: true }).first();
    if ((await button.count().catch(() => 0)) === 0) continue;
    await button.click({ timeout: 3000 }).catch(() => undefined);
    return;
  }
};
