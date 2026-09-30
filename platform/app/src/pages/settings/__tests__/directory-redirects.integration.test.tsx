/**
 * @vitest-environment jsdom
 *
 * The two addresses the Directory page absorbed, still resolving.
 *
 * Both render `<Navigate>` rather than a `loader` redirect, because loaders
 * do not run on a cold load of the SPA — which is exactly how a stale
 * bookmark or an identity-provider runbook arrives. So the test drives the
 * real router and reads where it landed, rather than reading the source for
 * the string.
 *
 * Spec: specs/identity/org-access-cluster.feature
 */
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

const ScimRedirect = (await import("../scim")).default;
const GroupsRedirect = (await import("../groups")).default;
const MembersRedirect = (await import("../members")).default;
const AccessRedirect = (await import("../access")).default;

function Landed() {
  const location = useLocation();
  return (
    <div data-testid="landed">{`${location.pathname}${location.search}`}</div>
  );
}

function renderFrom(address: string) {
  return render(
    <MemoryRouter initialEntries={[address]}>
      <Routes>
        <Route path="/settings/scim" element={<ScimRedirect />} />
        <Route path="/settings/groups" element={<GroupsRedirect />} />
        <Route path="/settings/members" element={<MembersRedirect />} />
        <Route path="/settings/access" element={<AccessRedirect />} />
        <Route path="/settings/directory" element={<Landed />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("given an address the Directory page absorbed", () => {
  afterEach(() => cleanup());

  describe("when the old directory sync address is opened", () => {
    /** @scenario The old directory sync address forwards onto the page it became */
    it("lands on the directory page", () => {
      renderFrom("/settings/scim");

      expect(screen.getByTestId("landed").textContent).toBe(
        "/settings/directory",
      );
    });
  });

  describe("when the old groups address is opened", () => {
    /** @scenario The old groups address forwards onto the tab it became */
    it("lands on the groups tab rather than on the status", () => {
      renderFrom("/settings/groups");

      expect(screen.getByTestId("landed").textContent).toBe(
        "/settings/directory?tab=groups",
      );
    });
  });

  describe("when the old members address is opened", () => {
    /** @scenario The old members address forwards onto the tab it became */
    it("lands on the people, which is the tab that page became", () => {
      renderFrom("/settings/members");

      // People is the default cut of the directory's list, exactly as members
      // was the default tab of the page this address used to serve, so it
      // arrives with no query rather than with one that names the default.
      expect(screen.getByTestId("landed").textContent).toBe(
        "/settings/directory",
      );
    });

    /** @scenario The old members address forwards onto the tab it became */
    it("carries the cut somebody linked to across with them", () => {
      renderFrom("/settings/members?tab=requests");

      // A support thread that says "there are three people waiting" links
      // here, and that link has to keep landing on the three.
      expect(screen.getByTestId("landed").textContent).toBe(
        "/settings/directory?people=waiting",
      );
    });
  });

  describe("when the old access address is opened", () => {
    /** @scenario The old access address forwards onto the page it became */
    it("lands on the directory page", () => {
      renderFrom("/settings/access");

      expect(screen.getByTestId("landed").textContent).toBe(
        "/settings/directory",
      );
    });
  });
});
