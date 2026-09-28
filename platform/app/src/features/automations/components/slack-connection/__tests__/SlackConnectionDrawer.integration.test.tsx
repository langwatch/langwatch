/**
 * @vitest-environment jsdom
 *
 * The one Slack connection drawer: create either kind, the refusals that come
 * back from the server, and deleting a connection automations still use.
 * Spec: specs/automations/slack-connections.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Connection = {
  id: string;
  name: string;
  kind: "BOT" | "INCOMING_WEBHOOK";
  scopeType: "ORGANIZATION" | "PROJECT";
  scopeId: string;
  scopeName: string;
  secretHint: string;
  slackTeamId: string | null;
  slackTeamName: string | null;
  dependentAutomations: number;
  canManage: boolean;
  updatedAt: Date;
};

type MutationOptions = {
  onSuccess?: (result: unknown) => void;
  onError?: (error: unknown) => void;
};

const state = vi.hoisted(() => ({
  connections: [] as Connection[],
  canManageProject: true,
  canManageOrganization: true,
  createError: null as unknown,
  createCalls: [] as Record<string, unknown>[],
  updateCalls: [] as Record<string, unknown>[],
  deleteCalls: [] as Record<string, unknown>[],
  /** What each delete call answers: an error to raise, or success. */
  deleteAnswers: [] as Array<unknown | null>,
  closeDrawer: vi.fn(),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      slackIntegration: { list: { invalidate: vi.fn() } },
    }),
    slackIntegration: {
      list: {
        useQuery: () => ({
          data: {
            connections: state.connections,
            canManageProject: state.canManageProject,
            canManageOrganization: state.canManageOrganization,
          },
          error: null,
        }),
      },
      create: {
        useMutation: () => ({
          mutate: (input: Record<string, unknown>, opts?: MutationOptions) => {
            state.createCalls.push(input);
            if (state.createError) return;
            opts?.onSuccess?.({ id: "conn-new", kind: input.kind });
          },
          isPending: false,
          error: state.createError,
        }),
      },
      update: {
        useMutation: () => ({
          mutate: (input: Record<string, unknown>, opts?: MutationOptions) => {
            state.updateCalls.push(input);
            opts?.onSuccess?.({});
          },
          isPending: false,
          error: null,
        }),
      },
      delete: {
        useMutation: () => ({
          mutate: (input: Record<string, unknown>, opts?: MutationOptions) => {
            state.deleteCalls.push(input);
            const answer = state.deleteAnswers.shift() ?? null;
            if (answer) opts?.onError?.(answer);
            else opts?.onSuccess?.({ deleted: true, dependentAutomations: 0 });
          },
          isPending: false,
        }),
      },
    },
  },
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ closeDrawer: state.closeDrawer }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-1", name: "Acme" },
    project: { id: "project-1", name: "Checkout", slug: "checkout" },
  }),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

import { SlackConnectionDrawer } from "../SlackConnectionDrawer";

const handledError = (code: string, meta: Record<string, unknown>) => ({
  data: { error: { code, httpStatus: 409, meta } },
});

const connection = (overrides: Partial<Connection> = {}): Connection => ({
  id: "conn-1",
  name: "Alerts bot",
  kind: "BOT",
  scopeType: "PROJECT",
  scopeId: "project-1",
  scopeName: "Checkout",
  secretHint: "abcd",
  slackTeamId: "T1",
  slackTeamName: "Acme HQ",
  dependentAutomations: 3,
  canManage: true,
  updatedAt: new Date(),
  ...overrides,
});

function renderDrawer(props: Parameters<typeof SlackConnectionDrawer>[0]) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <SlackConnectionDrawer {...props} />
    </ChakraProvider>,
  );
}

describe("SlackConnectionDrawer", () => {
  beforeEach(() => {
    state.connections = [];
    state.canManageProject = true;
    state.canManageOrganization = true;
    state.createError = null;
    state.createCalls.length = 0;
    state.updateCalls.length = 0;
    state.deleteCalls.length = 0;
    state.deleteAnswers.length = 0;
    state.closeDrawer.mockReset();
  });

  afterEach(() => cleanup());

  describe("when a bot connection is added for the organization", () => {
    /** @scenario "Adding a bot connection for the organization" */
    it("creates it with the organization scope and hands it back", async () => {
      const user = userEvent.setup();
      const onSuccess = vi.fn();
      const onClose = vi.fn();
      renderDrawer({ onSuccess, onClose });

      await user.type(screen.getByPlaceholderText("Alerts bot"), "Alerts bot");
      await user.click(screen.getByTestId("quick-scope-organization"));
      await user.type(screen.getByPlaceholderText("xoxb-…"), "xoxb-secret");
      await user.click(screen.getByRole("button", { name: "Add connection" }));

      expect(state.createCalls).toEqual([
        {
          projectId: "project-1",
          name: "Alerts bot",
          kind: "BOT",
          scopeType: "ORGANIZATION",
          scopeId: "org-1",
          secret: "xoxb-secret",
        },
      ]);
      expect(onSuccess).toHaveBeenCalledWith({
        connectionId: "conn-new",
        name: "Alerts bot",
        kind: "BOT",
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("shows how to create the Slack app beside the token field", () => {
      renderDrawer({});

      expect(
        screen.getByRole("link", { name: /create a slack app/i }),
      ).toBeInTheDocument();
    });
  });

  describe("when a webhook connection is added for one project", () => {
    /** @scenario "Adding a webhook connection for one project" */
    it("creates an incoming webhook scoped to the project", async () => {
      const user = userEvent.setup();
      renderDrawer({});

      await user.click(screen.getByText("Incoming webhook"));
      await user.type(
        screen.getByPlaceholderText("Alerts channel webhook"),
        "Ops room",
      );
      await user.type(
        screen.getByPlaceholderText("https://hooks.slack.com/services/…"),
        "https://hooks.slack.com/services/T/B/x",
      );
      await user.click(screen.getByRole("button", { name: "Add connection" }));

      expect(state.createCalls[0]).toMatchObject({
        kind: "INCOMING_WEBHOOK",
        scopeType: "PROJECT",
        scopeId: "project-1",
      });
    });
  });

  describe("when the reader can manage the project but not the organization", () => {
    /** @scenario "Scope decides who may change a connection" */
    it("offers only the project scope", () => {
      state.canManageOrganization = false;
      renderDrawer({});

      expect(screen.getByTestId("quick-scope-project")).toBeInTheDocument();
      expect(
        screen.queryByTestId("quick-scope-organization"),
      ).not.toBeInTheDocument();
    });

    it("shows an organization connection read-only", () => {
      state.canManageOrganization = false;
      state.connections = [
        connection({
          scopeType: "ORGANIZATION",
          scopeId: "org-1",
          canManage: false,
        }),
      ];
      renderDrawer({ connectionId: "conn-1" });

      expect(
        screen.getByTestId("slack-connection-read-only"),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Delete" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("when the secret is already stored in the organization", () => {
    /** @scenario "The same secret cannot be stored twice in an organization" */
    it("names the existing connection next to the form", () => {
      state.createError = handledError("slack_connection_exists", {
        connectionName: "Alerts bot",
      });
      renderDrawer({});

      expect(
        screen.getByText(/already saved as "Alerts bot"/i),
      ).toBeInTheDocument();
    });
  });

  describe("when a saved connection is edited without retyping its secret", () => {
    /** @scenario "Editing a connection without retyping its secret keeps the secret" */
    it("shows only the hint and sends no secret", async () => {
      const user = userEvent.setup();
      state.connections = [connection()];
      renderDrawer({ connectionId: "conn-1" });

      expect(screen.getByText("••••abcd")).toBeInTheDocument();
      const name = screen.getByDisplayValue("Alerts bot");
      await user.clear(name);
      await user.type(name, "Release bot");
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(state.updateCalls).toEqual([
        {
          projectId: "project-1",
          id: "conn-1",
          name: "Release bot",
          scopeType: "PROJECT",
          scopeId: "project-1",
          secret: undefined,
        },
      ]);
    });

    /** @scenario "Replacing a secret needs no automation edits" */
    it("sends a replacement secret only once Replace is chosen", async () => {
      const user = userEvent.setup();
      state.connections = [connection()];
      renderDrawer({ connectionId: "conn-1" });

      await user.click(screen.getByRole("button", { name: "Replace" }));
      await user.type(screen.getByPlaceholderText("xoxb-…"), "xoxb-rotated");
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(state.updateCalls[0]).toMatchObject({ secret: "xoxb-rotated" });
    });
  });

  describe("when a connection automations deliver through is deleted", () => {
    /** @scenario "Deleting a connection in use says what stops delivering" */
    it("asks to confirm with the count before sending anything, then deletes with force", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      state.connections = [connection()];
      renderDrawer({ connectionId: "conn-1", onClose });

      await user.click(screen.getByRole("button", { name: "Delete" }));

      expect(
        await screen.findByText(
          "3 automations stop delivering until they pick another connection.",
        ),
      ).toBeInTheDocument();
      expect(state.deleteCalls).toEqual([]);

      await user.click(
        screen.getByRole("button", { name: "Delete connection" }),
      );

      await waitFor(() =>
        expect(state.deleteCalls).toEqual([
          { projectId: "project-1", id: "conn-1", force: true },
        ]),
      );
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("when a connection listed as unused turns out to be in use", () => {
    /** @scenario "Deleting a connection in use says what stops delivering" */
    it("escalates to the in-use confirmation with the live count", async () => {
      const user = userEvent.setup();
      state.connections = [connection({ dependentAutomations: 0 })];
      state.deleteAnswers.push(
        handledError("slack_connection_in_use", { dependentAutomations: 2 }),
      );
      renderDrawer({ connectionId: "conn-1" });

      await user.click(screen.getByRole("button", { name: "Delete" }));
      await user.click(
        await screen.findByRole("button", { name: "Delete connection" }),
      );

      expect(
        await screen.findByText(
          "2 automations stop delivering until they pick another connection.",
        ),
      ).toBeInTheDocument();
      expect(state.deleteCalls).toEqual([
        { projectId: "project-1", id: "conn-1" },
      ]);
    });
  });

  describe("when a connection nothing delivers through is deleted", () => {
    /** @scenario "Deleting an unused connection is confirmed too" */
    it("asks to confirm first, then deletes without force", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      state.connections = [connection({ dependentAutomations: 0 })];
      renderDrawer({ connectionId: "conn-1", onClose });

      await user.click(screen.getByRole("button", { name: "Delete" }));

      expect(
        await screen.findByText(
          "Nothing uses it; its saved secret is removed.",
        ),
      ).toBeInTheDocument();
      expect(state.deleteCalls).toEqual([]);

      await user.click(
        screen.getByRole("button", { name: "Delete connection" }),
      );

      await waitFor(() =>
        expect(state.deleteCalls).toEqual([
          { projectId: "project-1", id: "conn-1" },
        ]),
      );
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
