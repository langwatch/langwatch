/** `langy-theme.css` is imported for its side effect by the Langy panel surface. */
declare module "*.css" {
  const content: string;
  export default content;
}
