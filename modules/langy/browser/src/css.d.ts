/**
 * `langy-context-target.css` is imported for its side effect by
 * `useLangyContextTarget`.
 */
declare module "*.css" {
  const content: string;
  export default content;
}

declare module "*?raw" {
  const content: string;
  export default content;
}
