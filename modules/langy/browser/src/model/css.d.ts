/**
 * `langy-context-target.css` is imported for its side effect by the context target
 * layer and its hook.
 */
declare module "*.css" {
  const content: string;
  export default content;
}
