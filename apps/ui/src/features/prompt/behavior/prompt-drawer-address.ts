/**
 * The address the trace drawer (`traceV2Details`) opens at, from a Prompt
 * Studio playground turn — written here, not by the screen, clearing every
 * stale `drawer.*` key exactly as `openDrawer` does.
 */
export function resolvePromptDrawerAddress({
  query,
  drawer,
  params = {},
}: {
  query: Readonly<Record<string, string | undefined>>;
  drawer: "traceV2Details";
  params?: Readonly<Record<string, string | undefined>>;
}): Record<string, string | undefined> {
  const cleared: Record<string, string | undefined> = {};
  for (const key of Object.keys(query)) {
    if (key.startsWith("drawer.")) cleared[key] = void 0;
  }
  const next: Record<string, string | undefined> = { ...cleared, "drawer.open": drawer };
  for (const [name, value] of Object.entries(params)) {
    next[`drawer.${name}`] = value;
  }
  return next;
}
