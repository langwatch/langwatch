/**
 * The home imports two stylesheets for side effect — its hero scroll and the
 * serif display voice for headings. Vite injects them; TypeScript needs
 * telling the modules exist, as `@langwatch/langy-browser` already does.
 */
declare module "*.css" {
  const content: string;
  export default content;
}
