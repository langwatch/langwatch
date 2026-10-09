/**
 * @vitest-environment jsdom
 * An organization screen asks its own host for a permission, and reads what the legacy hook read.
 * Spec: specs/frontend/session-permission-reads.feature (scope knot, plan batch 4b).
 */
import {
  createUiScopeHost,
  UiScopeHostProvider,
  useOrganizationTeamProject,
} from "@langwatch/browser-host/use-organization-team-project";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OrganizationHostProvider } from "../../model/organization-host.ts";
import { FakeOrganizationHost } from "../../testing.tsx";
import { useDepartmentColumn } from "../use-department-column.ts";

vi.mock("../organization-api.ts", () => {
  const list = () => ({ data: [{ id: "dept_mkt", name: "Marketing" }], isLoading: false });
  const assignments = () => ({ data: undefined, isLoading: false });
  return {
    api: {
      departments: { list: { useQuery: list }, assignments: { useQuery: assignments } },
      useUtils: () => ({ departments: { assignments: { invalidate: vi.fn() } } }),
    },
  };
});

function Probe() {
  const legacy = useOrganizationTeamProject();
  const department = useDepartmentColumn("org_1", true);
  return (
    <>
      <output aria-label="legacy">{String(legacy.hasPermission("governance:view"))}</output>
      <output aria-label="migrated">{String(department.show)}</output>
    </>
  );
}

const renderFor = (grants: ReadonlySet<string>) =>
  render(
    <UiScopeHostProvider
      value={createUiScopeHost({
        project: () => ({ id: "proj_1", slug: "acme", name: "Acme" }),
        organization: () => ({ id: "org_1" }),
        team: () => ({ id: "team_1" }),
        hasPermission: (permission) => grants.has(permission),
      })}
    >
      <OrganizationHostProvider value={new FakeOrganizationHost({ grants })}>
        <Probe />
      </OrganizationHostProvider>
    </UiScopeHostProvider>,
  );

afterEach(cleanup);

describe("given a signed-in reader whose role grants some permissions and not others", () => {
  describe("when a migrated organization screen reads a permission from the organization host", () => {
    /** @scenario "A migrated screen answers a signed-in reader the same as before" */
    it.each([
      ["held", new Set(["organization:view", "governance:view"])],
      ["not held", new Set(["organization:view"])],
    ])("reads a %s permission as the legacy scope hook did", (_label, grants) => {
      renderFor(grants);
      expect(screen.getByLabelText("migrated").textContent).toBe(
        screen.getByLabelText("legacy").textContent,
      );
    });
  });
});
