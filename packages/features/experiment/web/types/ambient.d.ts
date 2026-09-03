/**
 * Module shapes the bundler resolves and the compiler cannot.
 *
 * `@langwatch/langy-web` — which this family's list page reaches for the
 * context-target chip — side-effect imports its own stylesheet, and a workspace
 * package resolves to its dependency's SOURCE, so that import is compiled here.
 * Declaring it is the traces family's fix, third sighting.
 */
declare module "*.css";
