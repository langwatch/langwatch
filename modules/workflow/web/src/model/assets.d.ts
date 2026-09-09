/**
 * Stylesheets imported for their side effect.
 *
 * `@xyflow/react/dist/style.css` is the canvas's own stylesheet and the studio
 * imports it the way the library documents. TypeScript has no notion of a CSS
 * module, and the bundler does, so this declaration is what lets the import
 * stand without the compiler treating it as a missing module.
 */
declare module "*.css";
