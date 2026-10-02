// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { setWindowAddress } from "../../../../../__tests__/window-location-router.ts";

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import("../../../../../__tests__/window-location-router.ts")).windowLocationRouter,
}));

vi.mock("../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "ambient-project" } }),
}));

const { useDrawerProjectId } = await import("../use-drawer-project-id.ts");

const TRACE = "/acme/traces?drawer.open=traceV2Details&drawer.traceId=trace-1";

describe("useDrawerProjectId", () => {
  beforeEach(() => {
    setWindowAddress({ url: "/acme/traces" });
  });

  describe("given a drawer sitting in the project the chrome is on", () => {
    describe("when a trace opens without naming a project", () => {
      it("reads from the project the chrome is sitting in", () => {
        setWindowAddress({ url: TRACE });

        const { result } = renderHook(() => useDrawerProjectId());

        expect(result.current).toBe("ambient-project");
      });
    });
  });

  describe("given a trace whose project is not the one the chrome is on", () => {
    describe("when it opens naming that project", () => {
      /** @scenario "The replay reads the session's own workspace, not the last project visited" */
      it("reads from the named project rather than the chrome's", () => {
        setWindowAddress({ url: `${TRACE}&drawer.projectId=personal-project` });

        const { result } = renderHook(() => useDrawerProjectId());

        expect(result.current).toBe("personal-project");
      });
    });

    describe("when the drawer closes before the next trace opens", () => {
      /** @scenario "A replay opened fresh after closing reads the ambient project again" */
      it("forgets it, so the next trace is ambient again", () => {
        setWindowAddress({ url: `${TRACE}&drawer.projectId=personal-project` });
        const { result } = renderHook(() => useDrawerProjectId());

        act(() => setWindowAddress({ url: "/acme/traces" }));
        act(() => setWindowAddress({ url: TRACE }));

        expect(result.current).toBe("ambient-project");
      });
    });
  });
});
