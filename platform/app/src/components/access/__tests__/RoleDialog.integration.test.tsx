/**
 * @vitest-environment jsdom
 *
 * Writing a role, with the answer on screen while you write it.
 *
 * Spec: specs/identity/org-access-cluster.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  created: [] as unknown[],
  updated: [] as unknown[],
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      role: { getAll: { invalidate: vi.fn() } },
      roleBinding: { listForOrg: { invalidate: vi.fn() } },
    }),
    role: {
      create: {
        useMutation: () => ({
          mutateAsync: (input: unknown) => {
            state.created.push(input);
            return Promise.resolve(input);
          },
          isPending: false,
        }),
      },
      update: {
        useMutation: () => ({
          mutateAsync: (input: unknown) => {
            state.updated.push(input);
            return Promise.resolve(input);
          },
          isPending: false,
        }),
      },
    },
    apiKey: {
      orgTeams: {
        useQuery: () => ({
          data: [{ id: "team_1", name: "Platform" }],
          isLoading: false,
        }),
      },
      orgProjects: {
        useQuery: () => ({
          data: [{ id: "proj_1", name: "support-copilot", teamId: "team_1" }],
          isLoading: false,
        }),
      },
    },
  },
}));

const { RoleDialog } = await import("../RoleDialog");

function renderDialog(
  editing: {
    id: string;
    name: string;
    description: string | null;
    permissions: string[];
  } | null = null,
) {
  const onClose = vi.fn();
  render(
    <ChakraProvider value={defaultSystem}>
      <RoleDialog
        open
        organizationId="org_acme"
        organizationName="Acme"
        editing={editing}
        onClose={onClose}
      />
    </ChakraProvider>,
  );
  return { onClose };
}

async function setLevel({
  resource,
  level,
}: {
  resource: string;
  level: string;
}) {
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
    it("groups the permissions by the part of the product they are about", () => {
      renderDialog();

      expect(screen.getByText("Data and analysis")).toBeInTheDocument();
      expect(screen.getByText("Traces")).toBeInTheDocument();
      expect(
        screen.getByText("The recorded runs of your application."),
      ).toBeInTheDocument();
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

      expect(
        screen.getByRole("button", { name: "Create role" }),
      ).toBeDisabled();
      expect(
        screen.getByText("Choose at least one permission before saving."),
      ).toBeInTheDocument();
    });
  });

  describe("when a level is chosen for one part of the product", () => {
    /** @scenario The preview describes the role as it is built */
    it("describes what the role can do, in words", async () => {
      renderDialog();

      await setLevel({ resource: "traces", level: "Read" });

      const preview = within(screen.getByTestId("role-preview"));
      expect(preview.getByText("View traces")).toBeInTheDocument();
      expect(
        preview.getByText("1 permission across 1 area."),
      ).toBeInTheDocument();
    });

    /** @scenario A role is built one part of the product at a time */
    it("grants the one permission that covers the rest for full access", async () => {
      renderDialog();

      await setLevel({ resource: "datasets", level: "Full access" });

      const preview = within(screen.getByTestId("role-preview"));
      expect(preview.getByText("Full access to datasets")).toBeInTheDocument();
    });

    /** @scenario The preview describes the role as it is built */
    it("saves exactly what the preview described", async () => {
      renderDialog();

      await userEvent.type(
        screen.getByRole("textbox", { name: /Name/ }),
        "Support analyst",
      );
      await setLevel({ resource: "traces", level: "Read" });
      await userEvent.click(
        screen.getByRole("button", { name: "Create role" }),
      );

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

  describe("when the reader searches the permission list", () => {
    /** @scenario A role is built one part of the product at a time */
    it("keeps only what matches", async () => {
      renderDialog();

      await userEvent.type(
        screen.getByLabelText("Search permissions"),
        "datasets",
      );

      expect(screen.getByText("Datasets")).toBeInTheDocument();
      expect(screen.queryByText("Traces")).toBeNull();
    });

    /** @scenario A role is built one part of the product at a time */
    it("says so when nothing matches", async () => {
      renderDialog();

      await userEvent.type(
        screen.getByLabelText("Search permissions"),
        "zzzzz",
      );

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
      // The dialog marks everything outside itself hidden from assistive
      // technology, and the select's list is portalled to the body, so the
      // query has to look past that to find it.
      const listbox = await screen.findByRole("listbox", { hidden: true });
      const team = within(listbox)
        .getAllByRole("option", { hidden: true })
        .find((option) => option.textContent === "Platform");
      await userEvent.click(team!);

      const inert = within(await screen.findByTestId("role-preview-inert"));
      expect(inert.getByTestId("permission-token").textContent).toBe(
        "governance:view",
      );
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

      expect(screen.getByRole("textbox", { name: /Name/ })).toHaveValue(
        "Support analyst",
      );
      const preview = within(screen.getByTestId("role-preview"));
      expect(preview.getByText("View traces")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save role" })).toBeEnabled();
    });
  });
});
