/**
 * The Datasets host, as a value object.
 *
 * The adapter is what turns this application's capabilities into the questions
 * `@langwatch/dataset-web` asks, and it holds no hooks precisely so that it can
 * be constructed and read in a unit test. What is pinned here is that each
 * question is answered from the reading it was handed, and that
 * `isReportedGlobally` says NO — the recorded gap, which a later change to the
 * transport is expected to break on purpose.
 */

import { describe, expect, it, vi } from "vitest";
import {
  DATASET_PAGE_PERMISSION,
  UiDatasetHost,
} from "../src/features/dataset/behavior/dataset-host.adapter";

const readings = {
  project: { id: "proj_1", slug: "proj", name: "Proj" },
  hasPermission: (permission: string) => permission === "datasets:view",
  isLiteMember: false,
  copyTargets: [{ label: "Acme / Core / One", value: "p1" }],
  route: { params: { id: "ds_1" }, query: { tab: "rows" } },
};

function host(overrides: Partial<typeof readings> = {}) {
  const actions = {
    setQuery: vi.fn(),
    navigate: vi.fn(),
    succeeded: vi.fn(),
    failed: vi.fn(),
  };
  return { host: UiDatasetHost.create({ ...readings, ...overrides }, actions), actions };
}

describe("given the Datasets host adapter", () => {
  describe("when the screens read from it", () => {
    it("answers with the project, targets and address it was handed", () => {
      const { host: subject } = host();

      expect(subject.project()).toEqual({ id: "proj_1", slug: "proj", name: "Proj" });
      expect(subject.copyTargets()).toEqual([{ label: "Acme / Core / One", value: "p1" }]);
      expect(subject.route()).toEqual({ params: { id: "ds_1" }, query: { tab: "rows" } });
    });

    it("answers a grant from the session rather than from a fixed list", () => {
      const { host: subject } = host();

      expect(subject.hasPermission(DATASET_PAGE_PERMISSION)).toBe(true);
      expect(subject.hasPermission("datasets:manage")).toBe(false);
    });

    it("reports the lite membership it was handed", () => {
      expect(host({ isLiteMember: true }).host.isLiteMember()).toBe(true);
      expect(host().host.isLiteMember()).toBe(false);
    });
  });

  describe("when a screen has something to say", () => {
    it("passes each notice straight through to the capability", () => {
      const { host: subject, actions } = host();

      subject.succeeded({ title: "Dataset deleted" });
      subject.failed({ error: new Error("boom"), fallbackTitle: "Couldn't delete" });
      subject.navigate("/proj/datasets/ds_1");
      subject.setQuery({ tab: "columns" });

      expect(actions.succeeded).toHaveBeenCalledWith({ title: "Dataset deleted" });
      expect(actions.failed).toHaveBeenCalledWith({
        error: expect.any(Error),
        fallbackTitle: "Couldn't delete",
      });
      expect(actions.navigate).toHaveBeenCalledWith("/proj/datasets/ds_1");
      expect(actions.setQuery).toHaveBeenCalledWith({ tab: "columns" }, void 0);
    });
  });

  describe("when a screen asks whether a failure was already reported", () => {
    /**
     * The dedup a screen is asking about is `platform/app`'s: four global
     * interceptors on ITS MutationCache mark an error as already rendered. That
     * cache does not wrap the client `apps/ui` builds, so nothing reaching a
     * screen served from here has been through them.
     */
    it("says no, because this composition has no global handler", () => {
      const { host: subject } = host();

      expect(subject.isReportedGlobally()).toBe(false);
    });
  });
});
