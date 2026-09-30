/**
 * @vitest-environment jsdom
 *
 * Writing a role, with the answer on screen while you write it (main's RoleDialog suite).
 * Spec: specs/identity/org-access-cluster.feature
 */
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EditedRole } from "../role-dialog.tsx";

type MutationOptions = { onSuccess?: () => void; onError?: (error: unknown) => void };

const { api, state } = vi.hoisted(() => {
  const state = {
    created: [] as unknown[],
    updated: [] as unknown[],
    createOptions: null as MutationOptions | null,
    updateOptions: null as MutationOptions | null,
  };
  const api = {
    useUtils: () => ({
      role: { getAll: { invalidate: () => void 0 } },
      roleBinding: { listForOrg: { invalidate: () => void 0 } },
    }),
    role: {
      create: {
        useMutation: (options: MutationOptions) => {
          state.createOptions = options;
          return {
            mutateAsync: (input: unknown) => {
              state.created.push(input);
              return Promise.resolve(input);
            },
            isPending: false,
          };
        },
      },
      update: {
        useMutation: (options: MutationOptions) => {
          state.updateOptions = options;
          return {
            mutateAsync: (input: unknown) => {
              state.updated.push(input);
              return Promise.resolve(input);
            },
            isPending: false,
          };
        },
      },
    },
  };
  return { api, state };
});

vi.mock("../../../behavior/authz-api.ts", () => ({ authzApi: api }));

// Isolation is off: reload so the dialog binds this file's mock, not a sibling suite's.
vi.resetModules();
const { FakeAuthzHost, renderWithAuthzHost } = await import("../../../testing.tsx");
const { RoleDialog } = await import("../role-dialog.tsx");

function renderDialog(editing: EditedRole | null = null) {
  const onClose = vi.fn();
  const host = new FakeAuthzHost({
    structure: {
      organizationName: "Acme",
      teams: [{ id: "team_1", name: "Platform" }],
      projects: [{ id: "proj_1", name: "support-copilot", teamId: "team_1" }],
    },
  });
  renderWithAuthzHost(
    <RoleDialog open organizationId="org_acme" editing={editing} onClose={onClose} />,
    host,
  );
  return { onClose, host };
}

/** The groups start closed, so a test reaches a row the way a person does. */
async function openArea(area: string) {
  const header = screen.getByTestId(`permission-area-${area}`);
  if (header.getAttribute("aria-expanded") !== "true") {
    await userEvent.click(header);
  }
}

async function setLevel({
  resource,
  area,
  level,
}: {
  resource: string;
  area: string;
  level: string;
}) {
  await openArea(area);
  const control = within(screen.getByTestId(`access-level-${resource}`));
  await userEvent.click(control.getByText(level));
}

describe("given somebody writing a new role", () => {
  beforeEach(() => {
    state.created = [];
    state.updated = [];
  });
  afterEach(() => cleanup());

  describe("when the dialog opens", () => {
    /** @scenario A role is built one part of the product at a time */
    it("groups the permissions by the part of the product they are about", async () => {
      renderDialog();

      expect(screen.getByText("New role")).toBeInTheDocument();
      expect(screen.getByText("Data and analysis")).toBeInTheDocument();
      expect(screen.queryByText("Traces")).toBeNull();

      await openArea("Data and analysis");

      expect(screen.getByText("Traces")).toBeInTheDocument();
      expect(screen.getByText("The recorded runs of your application.")).toBeInTheDocument();
    });

    /** @scenario The preview describes the role as it is built */
    it("says there is nothing to describe yet", () => {
      renderDialog();

      const preview = within(screen.getByTestId("role-preview"));
      expect(preview.getByText(/Nothing yet/)).toBeInTheDocument();
    });

    /** @scenario The preview describes the role as it is built */
    it("refuses to save a role that grants nothing, and says why", () => {
      renderDialog();

      expect(screen.getByRole("button", { name: "Create role" })).toBeDisabled();
      expect(screen.getByText("Choose at least one permission before saving.")).toBeInTheDocument();
    });
  });

  describe("when a level is chosen for one part of the product", () => {
    /** @scenario The preview describes the role as it is built */
    it("describes what the role can do, in words", async () => {
      renderDialog();

      await setLevel({ resource: "traces", area: "Data and analysis", level: "Read" });

      const preview = within(screen.getByTestId("role-preview"));
      expect(preview.getByText("View traces")).toBeInTheDocument();
      expect(preview.getByText("1 permission across 1 area.")).toBeInTheDocument();
    });

    /** @scenario A role is built one part of the product at a time */
    it("grants the one permission that covers the rest for full access", async () => {
      renderDialog();

      await setLevel({ resource: "datasets", area: "Building", level: "Full access" });

      const preview = within(screen.getByTestId("role-preview"));
      expect(preview.getByText("Full access to datasets")).toBeInTheDocument();
    });

    /** @scenario The preview describes the role as it is built */
    /** @scenario An administrator defines a custom role */
    it("saves exactly what the preview described", async () => {
      renderDialog();

      await userEvent.type(screen.getByRole("textbox", { name: /Name/ }), "Support analyst");
      await setLevel({ resource: "traces", area: "Data and analysis", level: "Read" });
      await userEvent.click(screen.getByRole("button", { name: "Create role" }));

      expect(state.created).toEqual([
        {
          organizationId: "org_acme",
          name: "Support analyst",
          description: "",
          permissions: ["traces:view"],
        },
      ]);
    });
  });

  describe("when a single action is unticked under full access", () => {
    /** @scenario A row ticked only because manage is sends its click to manage */
    it("withdraws the full access that implied it", async () => {
      renderDialog();

      await setLevel({ resource: "datasets", area: "Building", level: "Full access" });
      await userEvent.click(screen.getByRole("button", { name: "Choose actions for Datasets" }));
      await userEvent.click(screen.getByRole("checkbox", { name: /^View Read them/ }));

      const preview = within(screen.getByTestId("role-preview"));
      expect(preview.getByText(/Nothing yet/)).toBeInTheDocument();
    });
  });

  describe("when the name is missing or too long", () => {
    /** @scenario A role is saved only with a name that fits */
    it("asks for a name and saves nothing", async () => {
      renderDialog();

      await setLevel({ resource: "traces", area: "Data and analysis", level: "Read" });
      await userEvent.click(screen.getByRole("button", { name: "Create role" }));

      expect(await screen.findByText("Give this role a name")).toBeInTheDocument();
      expect(state.created).toEqual([]);
    });

    /** @scenario A role is saved only with a name that fits */
    it("keeps the name under 50 characters", async () => {
      renderDialog();

      await userEvent.type(screen.getByRole("textbox", { name: /Name/ }), "x".repeat(51));
      await setLevel({ resource: "traces", area: "Data and analysis", level: "Read" });
      await userEvent.click(screen.getByRole("button", { name: "Create role" }));

      expect(await screen.findByText("Keep the name under 50 characters")).toBeInTheDocument();
      expect(state.created).toEqual([]);
    });
  });

  describe("when the save answers", () => {
    /** @scenario An administrator defines a custom role */
    it("confirms a created role and closes", () => {
      const { host, onClose } = renderDialog();

      state.createOptions?.onSuccess?.();

      expect(host.successes).toEqual([{ title: "Role created" }]);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    /** @scenario A refused write is reported to the reader, not swallowed */
    it("hands a refused create to the host with the raw error", () => {
      const { host } = renderDialog();
      const refusal = new Error("validation_error");

      state.createOptions?.onError?.(refusal);

      expect(host.failures).toEqual([
        { error: refusal, fallbackTitle: "Couldn't create this role" },
      ]);
      expect(host.successes).toEqual([]);
    });

    /** @scenario A refused write is reported to the reader, not swallowed */
    it("hands a refused edit to the host with the raw error", () => {
      const { host } = renderDialog();
      const refusal = new Error("validation_error");

      state.updateOptions?.onError?.(refusal);

      expect(host.failures).toEqual([{ error: refusal, fallbackTitle: "Couldn't save this role" }]);
    });
  });

  describe("when the reader searches the permission list", () => {
    /** @scenario A role is built one part of the product at a time */
    it("keeps only what matches", async () => {
      renderDialog();

      await userEvent.type(screen.getByLabelText("Search permissions"), "datasets");

      expect(screen.getByText("Datasets")).toBeInTheDocument();
      expect(screen.queryByText("Traces")).toBeNull();
    });

    /** @scenario A role is built one part of the product at a time */
    it("says so when nothing matches", async () => {
      renderDialog();

      await userEvent.type(screen.getByLabelText("Search permissions"), "zzzzz");

      expect(screen.getByText(/Nothing matches/)).toBeInTheDocument();
    });
  });

  describe("when the role is previewed on a team rather than the organization", () => {
    /** @scenario The preview says which permissions do nothing at that scope */
    it("says which permissions grant nothing there", async () => {
      renderDialog({
        id: "role_1",
        name: "Security reviewer",
        description: null,
        permissions: ["governance:view", "traces:view"],
      });

      const preview = within(screen.getByTestId("role-preview"));
      expect(preview.queryByTestId("role-preview-inert")).toBeNull();

      await userEvent.click(screen.getByRole("combobox"));
      // The select's list is portalled outside the dialog, which hides it from assistive tech.
      const listbox = await screen.findByRole("listbox", { hidden: true });
      const team = within(listbox)
        .getAllByRole("option", { hidden: true })
        .find((option) => option.textContent === "Platform");
      expect(team).toBeDefined();
      if (team) await userEvent.click(team);

      const inert = within(await screen.findByTestId("role-preview-inert"));
      expect(inert.getByTestId("permission-token").textContent).toBe("governance:view");
    });
  });

  describe("when an existing role is opened", () => {
    /** @scenario The preview describes the role as it is built */
    it("starts from what the role already grants", () => {
      renderDialog({
        id: "role_1",
        name: "Support analyst",
        description: "Reads conversations.",
        permissions: ["traces:view"],
      });

      expect(screen.getByText("Edit role")).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: /Name/ })).toHaveValue("Support analyst");
      const preview = within(screen.getByTestId("role-preview"));
      expect(preview.getByText("View traces")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save role" })).toBeEnabled();
    });
  });
});
