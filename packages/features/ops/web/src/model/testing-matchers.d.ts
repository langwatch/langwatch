/**
 * The DOM matchers this package's suites assert with.
 *
 * `vitest.setup.ts` imports `@testing-library/jest-dom/vitest`, which is what
 * REGISTERS them; this reference is what makes the compiler aware of the
 * augmentation it performs, because the setup file is outside `include` and
 * `types` names package roots rather than subpath entries. Without it every
 * `toBeInTheDocument` in the package fails to typecheck while passing at
 * runtime.
 */
/// <reference types="@testing-library/jest-dom/vitest" />
