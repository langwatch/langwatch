/**
 * The home imports two stylesheets for their side effect — its own hero scroll
 * behaviour and the serif display voice the greeting, the banner and the
 * recents headings are set in. Vite resolves and injects them; TypeScript needs
 * telling that the modules exist, the way `@langwatch/langy-web` already does
 * for its own.
 */
declare module "*.css" {
  const content: string;
  export default content;
}
