/**
 * @vitest-environment node
 *
 * Unit tests for the project-slug redirect path builder.
 *
 * Regression coverage for the post-Vite-migration bug where
 * `/[project]/<section>` redirected to `/<realSlug>` (home) instead of
 * `/<realSlug>/<section>`, dropping the section tail and confusing users who
 * clicked links copied from docs / templates that still contained the
 * `[project]` placeholder.
 */
import { describe, expect, it } from "vitest";
import { buildProjectRedirectPath } from "../projectSlugRedirect";

describe("buildProjectRedirectPath()", () => {
  describe("given a placeholder project slug in the URL", () => {
    describe("when the URL has a single-segment tail", () => {
      it("replaces the first segment and preserves the tail", () => {
        expect(
          buildProjectRedirectPath({
            asPath: "/[project]/evaluations",
            projectSlug: "ad-demo-F9NtSC",
          })
        ).toBe("/ad-demo-F9NtSC/evaluations");
      });
    });

    describe("when the URL has a nested sub-path", () => {
      it("preserves the full tail", () => {
        expect(
          buildProjectRedirectPath({
            asPath: "/[project]/annotations/my-queue",
            projectSlug: "ad-demo-F9NtSC",
          })
        ).toBe("/ad-demo-F9NtSC/annotations/my-queue");
      });
    });

    describe("when the URL has a query string", () => {
      it("preserves the query string", () => {
        expect(
          buildProjectRedirectPath({
            asPath: "/[project]/messages?topics=greeting&sentiment=positive",
            projectSlug: "ad-demo-F9NtSC",
          })
        ).toBe(
          "/ad-demo-F9NtSC/messages?topics=greeting&sentiment=positive"
        );
      });
    });

    describe("when the URL is the bare placeholder", () => {
      it("redirects to the project home", () => {
        expect(
          buildProjectRedirectPath({
            asPath: "/[project]",
            projectSlug: "ad-demo-F9NtSC",
          })
        ).toBe("/ad-demo-F9NtSC");
      });
    });

    describe("when the URL is the bare placeholder with a trailing slash", () => {
      it("redirects to the project home without a trailing slash", () => {
        expect(
          buildProjectRedirectPath({
            asPath: "/[project]/",
            projectSlug: "ad-demo-F9NtSC",
          })
        ).toBe("/ad-demo-F9NtSC/");
      });
    });
  });

  describe("given an unknown (but not placeholder) project slug", () => {
    it("replaces the first segment with the real slug and preserves the tail", () => {
      expect(
        buildProjectRedirectPath({
          asPath: "/unknown-slug/evaluations/new/choose",
          projectSlug: "real-project",
        })
      ).toBe("/real-project/evaluations/new/choose");
    });

    it("preserves the query string when present", () => {
      expect(
        buildProjectRedirectPath({
          asPath: "/unknown-slug/messages?drawer.open=trace",
          projectSlug: "real-project",
        })
      ).toBe("/real-project/messages?drawer.open=trace");
    });
  });

  describe("given a URL with only the first segment", () => {
    it("redirects to the real project home", () => {
      expect(
        buildProjectRedirectPath({
          asPath: "/unknown-slug",
          projectSlug: "real-project",
        })
      ).toBe("/real-project");
    });

    it("preserves a query string attached to the home path", () => {
      expect(
        buildProjectRedirectPath({
          asPath: "/unknown-slug?return_to=%2Fsomewhere",
          projectSlug: "real-project",
        })
      ).toBe("/real-project?return_to=%2Fsomewhere");
    });
  });

  describe("given a URL with a hash fragment", () => {
    it("preserves the hash on the home path", () => {
      expect(
        buildProjectRedirectPath({
          asPath: "/unknown-slug#section",
          projectSlug: "real-project",
        })
      ).toBe("/real-project#section");
    });

    it("preserves the hash on a sub-path", () => {
      expect(
        buildProjectRedirectPath({
          asPath: "/[project]/messages#filters",
          projectSlug: "real-project",
        })
      ).toBe("/real-project/messages#filters");
    });

    it("preserves both query string and hash", () => {
      expect(
        buildProjectRedirectPath({
          asPath: "/[project]/messages?topics=x#filters",
          projectSlug: "real-project",
        })
      ).toBe("/real-project/messages?topics=x#filters");
    });
  });
});
