/**
 * The ambient module shapes this package's own source, and its workspace
 * dependencies' source, rely on.
 *
 * Workspace packages resolve to each other's SOURCE, so a consumer compiles a
 * dependency's `?raw` and `*.css` imports with no way to reach a `.d.ts` that
 * only the owner's `include` covers — the automations family recorded this as
 * the fourth family's own addition, and `@langwatch/langy-web` is where it
 * bites here. The onboarding snippets this package moved are `?raw` imports of
 * `.py`, `.sts`, `.go`, `.yaml` and `.sh` files, which is the other half.
 */

declare module "*.css";

declare module "*?raw" {
  const content: string;
  export default content;
}
