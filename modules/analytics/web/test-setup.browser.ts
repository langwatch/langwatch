/**
 * What a real-browser test in this package needs before it renders
 * anything — narrowed from `platform/app`'s setup. That version also
 * stubs `process.env`, but no screen here may read it (`ui-screen-closure`).
 */

import "@testing-library/jest-dom/vitest";
