/**
 * The address the trace drawer opens at, from a Prompt Studio playground turn.
 *
 * `traceV2Details` is registered in `platform/app` and opened by most of the
 * product, so this move may neither delete nor copy it. The `drawer.`
 * vocabulary is written HERE rather than by the screen — the model-config
 * family's shape — including the clearing of every stale `drawer.*` key,
 * exactly as `openDrawer` does.
 *
 * KNOWN GAP: nothing mounts that registry above a screen served from
 * `apps/ui` until the chrome layout route exists, so the address is right and
 * the drawer does not open yet.
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
