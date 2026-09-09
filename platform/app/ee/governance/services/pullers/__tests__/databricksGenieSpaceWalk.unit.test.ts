// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The sweep's space enumeration, after it started sharing its walk with the
 * on-demand agent listing.
 *
 * The chain from the adapter down to ClickHouse is covered by
 * `databricksGeniePuller.integration.test.ts`, which needs a datastore. This
 * file needs none: it mocks the transport and asks the two questions the shared
 * walk could get wrong — that the sweep still follows a second page, and that
 * it still stops when its request budget is spent rather than when a page cap
 * says so, because the budget is the half the two callers do NOT share.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DatabricksGeniePuller } from "../databricksGenie.puller";

vi.mock("~/utils/ssrfProtection", () => ({ ssrfSafeFetch: vi.fn() }));
const { ssrfSafeFetch } = await import("~/utils/ssrfProtection");
const fetchMock = vi.mocked(ssrfSafeFetch);

const workspaceUrl = "https://adb-1.azuredatabricks.net";

const reply = (body: unknown) =>
  ({
    ok: true,
    status: 200,
    statusText: "",
    json: async () => body,
  }) as unknown as Awaited<ReturnType<typeof ssrfSafeFetch>>;

const config = {
  adapter: "databricks_genie" as const,
  workspaceUrl,
  spaceIds: [],
  schedule: "*/15 * * * *",
};

const requestedUrls = () =>
  fetchMock.mock.calls.map(([url]) => String(url).replace(workspaceUrl, ""));

beforeEach(() => {
  fetchMock.mockReset();
});

describe("DatabricksGeniePuller space enumeration", () => {
  describe("given the workspace answers the space list across two pages", () => {
    it("follows the continuation token and sweeps both spaces", async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (url.includes("/genie/spaces?") && !url.includes("page_token")) {
          return reply({
            spaces: [{ space_id: "s1", title: "One" }],
            next_page_token: "p2",
          });
        }
        if (url.includes("page_token=p2")) {
          return reply({ spaces: [{ space_id: "s2", title: "Two" }] });
        }
        return reply({ conversations: [] });
      });

      const result = await new DatabricksGeniePuller().runOnce(
        { cursor: null, credentials: { token: "t" } },
        config,
      );

      const urls = requestedUrls();
      expect(urls.filter((u) => u.includes("page_token=p2"))).toHaveLength(1);
      // Both spaces were reached, which is the thing a dropped second page
      // would silently cost: the sweep would run green over half the workspace.
      expect(urls.some((u) => u.includes("/spaces/s1/conversations"))).toBe(
        true,
      );
      expect(urls.some((u) => u.includes("/spaces/s2/conversations"))).toBe(
        true,
      );
      expect(result.errorCount).toBe(0);
    });
  });

  describe("given the run's request budget is spent on the first page", () => {
    it("stops the walk rather than reading on to a page cap", async () => {
      fetchMock.mockImplementation(async () =>
        reply({
          spaces: [{ space_id: "s1", title: "One" }],
          next_page_token: "p2",
        }),
      );

      // One request for the whole run: the first page is read, and the budget
      // is exhausted before the second is asked for.
      await new DatabricksGeniePuller({ maxRequests: 1 }).runOnce(
        { cursor: null, credentials: { token: "t" } },
        config,
      );

      expect(requestedUrls()).toHaveLength(1);
    });
  });

  describe("given the workspace serves a page token it already served", () => {
    it("fails the run instead of re-reading pages in a cycle", async () => {
      fetchMock.mockImplementation(async () =>
        reply({
          spaces: [{ space_id: "s1", title: "One" }],
          next_page_token: "same",
        }),
      );

      const result = await new DatabricksGeniePuller().runOnce(
        { cursor: null, credentials: { token: "t" } },
        config,
      );

      // Enumerating spaces is the one part of the sweep that is not isolated,
      // so a cycle leaves the cursor where it was and reports the failure.
      expect(result).toMatchObject({ cursor: null, errorCount: 1 });
      expect(result.events).toEqual([]);
    });
  });
});
