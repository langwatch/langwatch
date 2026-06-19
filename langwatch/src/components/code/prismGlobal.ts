/**
 * Assigns the shared prismjs instance onto the global scope.
 *
 * The prismjs grammar component modules (prism-bash, prism-typescript, ...)
 * register themselves onto `global.Prism` at import time, so this assignment
 * must run before any of them evaluate. Kept in its own module and imported
 * first by `prismLanguages.ts` so module evaluation order guarantees the
 * ordering without resorting to inline `import()`.
 */
import { Prism } from "prism-react-renderer";

(typeof global !== "undefined" ? global : window).Prism = Prism;

export { Prism };
