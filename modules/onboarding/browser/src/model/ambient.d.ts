/**
 * Ambient declaration for Vite's ?raw module suffix to resolve bundled snippets.
 */

declare module "*?raw" {
  const content: string;
  export default content;
}
