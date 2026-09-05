/**
 * @vitest-environment jsdom
 *
 * Settings → General: one address, two things it edits. A PERSONAL workspace is never offered as the org's project; a project-less org (ADR-038 v6) still gets settings; a VIEW-only reader gets read-only fields and no storage credentials; a LITE MEMBER gets no Save button.
 */

import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { calls } = vi.hoisted(() => ({
  calls: { updateOrganization: vi.fn(), updateProject: vi.fn(), invalidate: vi.fn() },
}));

vi.mock("../../../behavior/project-api", () => {
  const utils = {
    organization: { getAll: { invalidate: calls.invalidate } },
    governance: { resolveHome: { invalidate: calls.invalidate } },
  };
  return {
    projectApi: { useUtils: () => utils },
    api: {
      useUtils: () => utils,
      organization: {
        update: {
          useMutation: () => ({ isPending: false, mutate: calls.updateOrganization }),
        },
      },
      project: {
        update: {
          useMutation: () => ({ isPending: false, mutate: calls.updateProject }),
        },
      },
    },
  };
});

// The department control is `@langwatch/organization-web`'s, and it runs on
// THAT package's transport, which the composing application mounts app-wide
// alongside this one's. Nothing here is about departments, so the control is
// stubbed to the "no departments configured" answer it gives most readers.
vi.mock("@langwatch/organization-web/surfaces/department-picker", () => ({
  useDepartmentColumn: () => ({
    show: false,
    departments: [],
    byUser: new Map(),
    byTeam: new Map(),
    byProject: new Map(),
    refetch: () => {},
  }),
  DepartmentPicker: () => null,
}));

import { anOrganization, aProject, FakeProjectHost, renderWithProjectHost } from "../../../testing";
import ProjectSettingsScreen from "../project-settings.screen";

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("given no organization is in scope", () => {
  it("renders nothing rather than a form over nothing", () => {
    const { container } = renderWithProjectHost(
      <ProjectSettingsScreen />,
      new FakeProjectHost({ organization: null }),
    );

    expect(container.textContent).toBe("");
  });
});

describe("given an organization with a shared project", () => {
  it("offers both halves of the address", () => {
    renderWithProjectHost(<ProjectSettingsScreen />);

    expect(screen.getByText("Organization Settings")).toBeTruthy();
    expect(screen.getByText("Project-level Settings")).toBeTruthy();
  });
});

describe("given the project in scope is somebody's personal workspace", () => {
  /**
   * The one the comment in the screen is emphatic about: a personal workspace
   * belongs to one person, so the organization's settings page must neither
   * edit it nor offer to set it up.
   */
  it("keeps it out of the organization's settings entirely", () => {
    renderWithProjectHost(
      <ProjectSettingsScreen />,
      new FakeProjectHost({ project: aProject({ isPersonal: true }) }),
    );

    expect(screen.getByText("Organization Settings")).toBeTruthy();
    expect(screen.queryByText("Project-level Settings")).toBeNull();
  });
});

describe("given a governance-intent organization with no project at all", () => {
  it("still serves its organization settings", () => {
    renderWithProjectHost(<ProjectSettingsScreen />, new FakeProjectHost({ project: null }));

    expect(screen.getByText("Organization Settings")).toBeTruthy();
    expect(screen.queryByText("Project-level Settings")).toBeNull();
  });
});

describe("when the reader may only view the organization", () => {
  const viewer = () =>
    new FakeProjectHost({
      organization: anOrganization({ useCustomS3: true, s3Bucket: "acme-traces" }),
      permissions: ["organization:view"],
    });

  it("reads the name back instead of offering to change it", () => {
    renderWithProjectHost(<ProjectSettingsScreen />, viewer());

    expect(screen.getByText("Acme")).toBeTruthy();
  });

  it("never shows the object-storage credentials", () => {
    renderWithProjectHost(<ProjectSettingsScreen />, viewer());

    expect(screen.queryByPlaceholderText("Secret Access Key")).toBeNull();
    expect(screen.getByText(/only visible to organization managers/i)).toBeTruthy();
  });
});

describe("when the reader holds the lite membership seat", () => {
  /**
   * The ORGANIZATION half only — a lite seat carries no organization
   * change, and the project form keeps its own save.
   */
  it("takes the organization form's save away and leaves the project's", () => {
    renderWithProjectHost(<ProjectSettingsScreen />, new FakeProjectHost({ isLiteMember: true }));

    expect(screen.getAllByRole("button", { name: "Save Changes" })).toHaveLength(1);
  });
});

describe("when the reader may manage the organization and holds a full seat", () => {
  it("offers a save on each half", () => {
    renderWithProjectHost(<ProjectSettingsScreen />);

    expect(screen.getAllByRole("button", { name: "Save Changes" })).toHaveLength(2);
  });
});

describe("given the application mounts a project switcher", () => {
  /**
   * Chrome belongs to the route tree, so the control is handed in rather than
   * imported — the platform page put `DashboardLayout`'s selector in its own
   * header, which is exactly what a package may not reach for.
   */
  it("renders whatever the host hands it, and nothing when it hands none", () => {
    renderWithProjectHost(
      <ProjectSettingsScreen />,
      new FakeProjectHost({ projectSwitcher: <span>the project switcher</span> }),
    );

    expect(screen.getByText("the project switcher")).toBeTruthy();
  });
});
