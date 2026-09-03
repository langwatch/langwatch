// @vitest-environment node
/**
 * The docs-origin allowlist, asserted from a NON-development runtime.
 *
 * `docsUrl` becomes the `href` behind "Read the docs" (`ErrorActions.tsx`), and
 * it is not ours by the time it gets here: a handled error relayed from a Go
 * service is parsed out of an upstream response body with a bare `z.string()`
 * (`nlpgo/goHandledError.ts`, and the Langy relay frame does the same). That
 * body comes from whatever endpoint the customer configured.
 *
 * The allowlist used to name both branches of `getDocsBaseUrl` as constants, so
 * `http://localhost:3000` — the local Mintlify a contributor runs — was
 * accepted by every production bundle too. An upstream could therefore hand a
 * production browser a trusted-looking docs link pointing at a service on the
 * viewer's own machine.
 *
 * This file exists because the runtime is a property of the whole suite, not of
 * one test, and the default unit suite's is incidental: it supplies a `window`
 * on `localhost`, so the only thing that ever kept it out of the development
 * branch was the ambient value of `import.meta.env.DEV`. A regression test for
 * a production-only vulnerability must not rest on that. Two things now keep it
 * off: `@langwatch/config/docs-url` resolves for the runtime a composition root
 * CONFIGURED, and no suite configures one, so the default is production; and
 * `@vitest-environment node` removes `window` as well. So this file is the
 * production case by construction, and stays one however the shared setup
 * changes.
 *
 * The complementary half, that a contributor's local docs still resolve, is
 * `packages/config/src/__tests__/docs-url.unit.test.ts`: it drives the resolver
 * with an explicit `{ mode, hostname }` rather than depending on a runtime at
 * all.
 */
import { describe, expect, it } from "vitest";

import { readHandledError } from "../read-handled-error";

const trpcError = (error: unknown) => ({ data: { error } });

const docsLink = (docsUrl: string) =>
  readHandledError(trpcError({ code: "trace_not_found", httpStatus: 404, docsUrl }))?.docsUrl;

describe("readHandledError docs links", () => {
  describe("given a runtime that is not a local development client", () => {
    it("refuses the local docs origin", () => {
      expect(docsLink("http://localhost:3000/errors/query-timeout")).toBeUndefined();
    });

    /**
     * Same origin, different port: the allowlist is compared by origin, so a
     * neighbouring service on the viewer's machine is refused for the same
     * reason and not merely because :3000 was hardcoded somewhere.
     */
    it("refuses another local service pretending to be the docs", () => {
      expect(docsLink("http://localhost:8080/errors")).toBeUndefined();
      expect(docsLink("http://127.0.0.1:3000/errors")).toBeUndefined();
    });

    /**
     * The canonical docs site has to keep working here, or the fix would have
     * bought safety by breaking every real docs link in production.
     */
    it("keeps a link on the canonical docs origin", () => {
      expect(docsLink("https://docs.langwatch.ai/platform/data-retention")).toBe(
        "https://docs.langwatch.ai/platform/data-retention",
      );
    });
  });
});
