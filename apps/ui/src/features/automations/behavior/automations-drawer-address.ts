/**
 * The address a registered drawer opens at, composed from the page the
 * reader is already on.
 *
 * `@langwatch/automation-web` deliberately does not know this vocabulary. Its
 * screen names a drawer — `automation`, `viewAutomation` — and turning that
 * into `?drawer.open=<name>&drawer.<key>=<value>` is composition, which is
 * what this function does. It is the only place an alert email's link and a
 * row click can be shown to be the same address.
 *
 * THE STALE-KEY CASE IS THE ONE THAT BITES. Every other `drawer.*` key is
 * dropped: leaving a previous drawer's parameters behind is what makes the
 * editor open on the automation the reader was only looking at.
 */
export function resolveAutomationsDrawerAddress({
  query,
  drawer,
  params = {},
  openParam,
}: {
  query: Readonly<Record<string, string | undefined>>;
  drawer: string;
  params?: Readonly<Record<string, string | undefined>>;
  openParam: string;
}): Record<string, string | undefined> {
  const next: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(query)) {
    if (!key.startsWith("drawer.")) next[key] = value;
  }
  next[openParam] = drawer;
  for (const [name, value] of Object.entries(params)) {
    if (value !== void 0) next[`drawer.${name}`] = value;
  }
  return next;
}
