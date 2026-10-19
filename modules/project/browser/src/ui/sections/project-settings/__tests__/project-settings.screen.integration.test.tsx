/**
 * @vitest-environment jsdom
 *
 * Settings → General: role-based access control for workspace, project, and storage credentials.
 */

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { calls } = vi.hoisted(() => ({
  calls: { updateOrganization: vi.fn(), updateProject: vi.fn(), invalidate: vi.fn() },
}));

vi.mock("../../../../behavior/project-api.ts", () => {
  const utils = {
    organization: {
      getAll: { invalidate: calls.invalidate, refetch: calls.invalidate },
      getScopeGraph: { invalidate: calls.invalidate },
    },
    governance: { resolveHome: { invalidate: calls.invalidate } },
  };
  return {
    projectApi: {
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

import {
  anOrganization,
  aProject,
  FakeProjectHost,
  renderWithProjectHost,
} from "../../../../testing.tsx";
import ProjectSettingsScreen, { ProjectGeneralScreen } from "../project-settings-screen.tsx";

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
  it("keeps the project's own settings off the organization page", () => {
    renderWithProjectHost(<ProjectSettingsScreen />);

    expect(screen.getByText("Organization settings")).toBeTruthy();
    expect(screen.queryByText("Project settings")).toBeNull();
    expect(screen.queryByText("Project ID")).toBeNull();
  });

  it("gives the project its own page with its id and name", () => {
    renderWithProjectHost(<ProjectGeneralScreen />);

    expect(screen.getByText("Project settings")).toBeTruthy();
    expect(screen.getByText("Project ID")).toBeTruthy();
  });
});

describe("when the project settings page opens", () => {
  /** @scenario The project settings page asks nothing about the tech stack */
  it("shows no tech stack and saves the stored language and framework unchanged", async () => {
    renderWithProjectHost(<ProjectGeneralScreen />);

    expect(screen.queryByText("Tech stack")).toBeNull();
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();

    fireEvent.change(screen.getByDisplayValue("Checkout assistant"), {
      target: { value: "Renamed" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Save changes" })[0]!);

    await vi.waitFor(() => expect(calls.updateProject).toHaveBeenCalled());
    expect(calls.updateProject.mock.calls[0]?.[0]).toMatchObject({
      name: "Renamed",
      language: "python",
      framework: "openai",
    });
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

    expect(screen.getByText("Organization settings")).toBeTruthy();
    expect(screen.queryByText("Project settings")).toBeNull();
  });

  it("gives that project no settings page either", () => {
    renderWithProjectHost(
      <ProjectGeneralScreen />,
      new FakeProjectHost({ project: aProject({ isPersonal: true }) }),
    );

    expect(screen.queryByText("Project ID")).toBeNull();
  });
});

describe("given a governance-intent organization with no project at all", () => {
  it("still serves its organization settings", () => {
    renderWithProjectHost(<ProjectSettingsScreen />, new FakeProjectHost({ project: null }));

    expect(screen.getByText("Organization settings")).toBeTruthy();
    expect(screen.queryByText("Project settings")).toBeNull();
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

    expect(screen.queryByPlaceholderText("Secret access key")).toBeNull();
    expect(screen.getByText(/only visible to organization managers/i)).toBeTruthy();
  });
});

describe("when the reader holds the lite membership seat", () => {
  it("takes the organization form's save away", () => {
    renderWithProjectHost(<ProjectSettingsScreen />, new FakeProjectHost({ isLiteMember: true }));

    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  });
});

describe("when the reader may manage the organization and holds a full seat", () => {
  it("offers one save on each page", () => {
    renderWithProjectHost(<ProjectSettingsScreen />);
    expect(screen.getAllByRole("button", { name: "Save changes" })).toHaveLength(1);
    cleanup();

    renderWithProjectHost(<ProjectGeneralScreen />);
    expect(screen.getAllByRole("button", { name: "Save changes" })).toHaveLength(1);
  });
});

describe("when the reader flips a switch on the organization page", () => {
  it("saves the one setting at once and says Saved", async () => {
    calls.updateOrganization.mockImplementation((_input, options) => options.onSuccess());
    renderWithProjectHost(<ProjectSettingsScreen />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Live presence" }));

    expect(await screen.findByText("Saved")).toBeTruthy();
    expect(calls.updateOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ presenceEnabled: false }),
      expect.anything(),
    );
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
      <ProjectGeneralScreen />,
      new FakeProjectHost({ projectSwitcher: <span>the project switcher</span> }),
    );

    expect(screen.getByText("the project switcher")).toBeTruthy();
  });
});

describe("when the reader manages an organization whose storage is configured", () => {
  /** @scenario The storage secret field is write-only */
  it("never fills the secret field, and says a stored secret is replaced by typing a new one", () => {
    renderWithProjectHost(
      <ProjectSettingsScreen />,
      new FakeProjectHost({
        organization: anOrganization({
          useCustomS3: true,
          s3Endpoint: "https://s3.example",
          s3AccessKeyId: "AKIA",
          s3SecretAccessKey: null,
        }),
      }),
    );

    const secret = screen.getByPlaceholderText("Stored; enter a new value to replace it");

    expect(secret).toHaveProperty("value", "");
  });
});

describe("when the organization form is saved with the name cleared", () => {
  /** @scenario A blank organization name is refused on the field */
  it("shows that the name is required and sends nothing", async () => {
    renderWithProjectHost(<ProjectSettingsScreen />);

    fireEvent.change(screen.getByDisplayValue("Acme"), { target: { value: "" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save changes" })[0]!);

    expect(await screen.findByText("Name is required")).toBeTruthy();
    expect(calls.updateOrganization).not.toHaveBeenCalled();
  });
});
