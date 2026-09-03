/**
 * The module shapes this package's own `include` has to state for itself.
 *
 * A side-effect `import "x.css"` is not a TypeScript module, and the
 * declaration that makes it one only applies inside the program that
 * `include`s it. `@langwatch/langy-web` declares its own; a workspace package
 * resolves to its dependency's SOURCE rather than to a build, so THIS program
 * compiles those files too and needs the declaration as well.
 *
 * Referenced from `screens/simulations/index.ts` with a triple-slash directive,
 * which is what pulls it into a consumer's program as well — the automations
 * family's addition, third sighting.
 */

declare module "*.css";

/**
 * `import.meta.env`, for a dependency's source this program also compiles.
 *
 * `@langwatch/trace-web/utils/docsUrl` reads it, and a workspace package
 * resolves to SOURCE — so the Vite client types that file relies on have to be
 * in this program too. Declared rather than pulled in through `types:
 * ["vite/client"]`, which would put every Vite ambient into a package that
 * does not build with Vite.
 */
interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
