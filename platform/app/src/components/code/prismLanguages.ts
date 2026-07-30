/**
 * Side-effect registrations of the prismjs grammars the app highlights.
 *
 * Importing `./prismGlobal` first assigns the global `Prism` instance the
 * component modules register onto; module evaluation order then guarantees the
 * grammars load afterwards. Order also matters between grammars:
 * prism-typescript extends the javascript grammar, so prism-javascript loads
 * first. Kept top-level rather than as inline `import()` calls.
 */
import "./prismGlobal";
// @ts-ignore — prismjs component modules lack type declarations
import "prismjs/components/prism-bash";
// @ts-ignore — prismjs component modules lack type declarations
import "prismjs/components/prism-python";
// @ts-ignore — prismjs component modules lack type declarations
import "prismjs/components/prism-diff";
// @ts-ignore — prismjs component modules lack type declarations
import "prismjs/components/prism-javascript";
// @ts-ignore — prismjs component modules lack type declarations
import "prismjs/components/prism-typescript";
