/**
 * `langy-context-target.css` is imported for its side effect by the context
 * target layer and its hook. Vite resolves and injects it; TypeScript needs
 * telling that the module exists, the same way `platform/app`'s
 * `vite-env.d.ts` does for the app's own stylesheets.
 */
declare module "*.css" {
  const content: string;
  export default content;
}
