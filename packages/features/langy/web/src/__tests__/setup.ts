/**
 * Unmounts what a test rendered, between tests.
 *
 * `@testing-library/react` registers this itself, but only when `afterEach` is
 * a global — which it is not here, because this package's tests import their
 * own from vitest. Without it every `render` accumulated in one document, and
 * the second test to look for `[data-testid="row"]` found two of them and
 * threw. Twenty tests across three files were failing on that rather than on
 * anything the components did.
 *
 * Registered here rather than by turning on `globals`, which would inject
 * `describe`/`it`/`expect` into 48 files that already import them.
 */
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
