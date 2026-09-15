/**
 * The address a registered drawer opens at, composed from the page the
 * reader is on. Every other `drawer.*` key is dropped — leaving a previous
 * drawer's parameters behind is what makes the editor open on the wrong one.
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
