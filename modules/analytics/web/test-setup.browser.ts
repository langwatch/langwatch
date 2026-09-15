/**
 * What a real-browser test in this package needs before it renders anything.
 *
 * `platform/app/test-setup.browser.ts`, narrowed to what these four files
 * actually use. The application's version also stubs `process.env` and installs
 * a public-config meta tag, both of which exist because its browser bundle
 * transitively reaches its own env loader. Nothing in this package does — a
 * governed screen may not read `process.env` at all, and `ui-screen-closure`
 * is what enforces it — so the stub would be dead weight that quietly permits
 * the import it is compensating for.
 */

import "@testing-library/jest-dom/vitest";
