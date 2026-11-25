/**
 * The ambient module shapes this package's own source, and its workspace dependencies'
 * source, rely on.
 */

declare module "*.css";

declare module "*?raw" {
  const content: string;
  export default content;
}
