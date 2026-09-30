/**
 * @vitest-environment jsdom
 * The Slack connection drawer: create, refusals, and deleting a claimed connection.
 * Spec: specs/automations/slack-connections.feature.
 */
import "@testing-library/jest-dom/vitest";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SlackConnectionDrawer } from "../slack-connection-drawer.tsx";

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
  createdAt: string;
  updatedAt: string;
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
  /** What each update call answers: an error to raise, or success. */
  updateAnswers: [] as unknown[],
  updateError: null as unknown,
  deleteCalls: [] as Record<string, unknown>[],
  /** What each delete call answers: an error to raise, or success. */
  deleteAnswers: [] as unknown[],
  closeDrawer: vi.fn(),
}));

vi.mock("@langwatch/slack-browser-kit", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  slackApi: {
    useUtils: () => ({ slackIntegration: { list: { invalidate: vi.fn() } } }),
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
            const answer = state.updateAnswers.shift() ?? null;
            state.updateError = answer;
            if (answer) opts?.onError?.(answer);
            else opts?.onSuccess?.({});
          },
          reset: vi.fn(),
          isPending: false,
          error: state.updateError,
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

vi.mock("@langwatch/browser-host/use-drawer", () => ({
  useDrawer: () => ({ closeDrawer: state.closeDrawer }),
}));

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-1", name: "Acme" },
    project: { id: "project-1", name: "Checkout", slug: "checkout" },
  }),
}));

vi.mock("@langwatch/browser-host/toaster", () => ({ toaster: { create: vi.fn() } }));

const handledError = ({ code, meta }: { code: string; meta: Record<string, unknown> }) => ({
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
  createdAt: "2026-09-30T00:00:00.000Z",
  updatedAt: "2026-09-30T00:00:00.000Z",
  ...overrides,
});

function renderDrawer(props: ComponentProps<typeof SlackConnectionDrawer>) {
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
    state.updateAnswers.length = 0;
    state.updateError = null;
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

      expect(screen.getByRole("link", { name: /create a slack app/i })).toBeInTheDocument();
    });
  });

  describe("when Add connection is clicked with the name and secret empty", () => {
    it("keeps the button enabled, marks both fields and sends nothing", async () => {
      const user = userEvent.setup();
      renderDrawer({});

      const add = screen.getByRole("button", { name: "Add connection" });
      expect(add).toBeEnabled();
      await user.click(add);

      expect(screen.getByText("Give the connection a name.")).toBeInTheDocument();
      expect(screen.getByText("Paste the bot token.")).toBeInTheDocument();
      expect(state.createCalls).toEqual([]);
    });
  });

  describe("when a webhook connection is added for one project", () => {
    /** @scenario "Adding a webhook connection for one project" */
    it("creates an incoming webhook scoped to the project", async () => {
      const user = userEvent.setup();
      renderDrawer({});

      await user.click(screen.getByText("Incoming webhook"));
      await user.type(screen.getByPlaceholderText("Alerts channel webhook"), "Ops room");
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
      expect(screen.queryByTestId("quick-scope-organization")).not.toBeInTheDocument();
    });

    it("shows an organization connection read-only", () => {
      state.canManageOrganization = false;
      state.connections = [
        connection({ scopeType: "ORGANIZATION", scopeId: "org-1", canManage: false }),
      ];
      renderDrawer({ connectionId: "conn-1" });

      expect(screen.getByTestId("slack-connection-read-only")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    });
  });

  describe("when the secret is already stored in that scope", () => {
    /** @scenario "The same secret cannot be stored twice in one scope" */
    it("names the existing connection next to the form", () => {
      state.createError = handledError({
        code: "slack_connection_exists",
        meta: { connectionName: "Alerts bot" },
      });
      renderDrawer({});

      expect(screen.getByText(/already saved as "Alerts bot"/i)).toBeInTheDocument();
    });
  });

  describe("when a webhook URL is refused by the server", () => {
    it("says so on the webhook field instead of in a generic alert", async () => {
      const user = userEvent.setup();
      state.createError = handledError({
        code: "invalid_action_params",
        meta: { field: "secret" },
      });
      renderDrawer({});

      await user.click(screen.getByText("Incoming webhook"));

      expect(screen.getByText(/isn't a Slack incoming webhook URL/)).toBeInTheDocument();
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  describe("when an organization connection other projects use is narrowed to this project", () => {
    /** @scenario "Narrowing an organization connection other projects use is confirmed first" */
    it("asks first with the count, then resends the update with force", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      state.connections = [connection({ scopeType: "ORGANIZATION", scopeId: "org-1" })];
      state.updateAnswers.push(
        handledError({ code: "slack_connection_in_use", meta: { dependentAutomations: 2 } }),
      );
      renderDrawer({ connectionId: "conn-1", onClose });

      await user.click(screen.getByTestId("quick-scope-project"));
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(
        await screen.findByText(
          "2 automations in other projects stop delivering until they pick another connection.",
        ),
      ).toBeInTheDocument();
      expect(state.updateCalls).toHaveLength(1);
      expect(state.updateCalls[0]).not.toHaveProperty("force");
      expect(onClose).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Limit to this project" }));

      await waitFor(() => expect(state.updateCalls).toHaveLength(2));
      expect(state.updateCalls[1]).toMatchObject({
        id: "conn-1",
        scopeType: "PROJECT",
        scopeId: "project-1",
        force: true,
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    describe("when the forced update then fails", () => {
      it("closes the confirmation and shows the failure inline", async () => {
        const user = userEvent.setup();
        state.connections = [connection({ scopeType: "ORGANIZATION", scopeId: "org-1" })];
        state.updateAnswers.push(
          handledError({ code: "slack_connection_in_use", meta: { dependentAutomations: 2 } }),
          handledError({ code: "slack_connection_not_found", meta: {} }),
        );
        renderDrawer({ connectionId: "conn-1", onClose: vi.fn() });

        await user.click(screen.getByTestId("quick-scope-project"));
        await user.click(screen.getByRole("button", { name: "Save" }));
        await user.click(await screen.findByRole("button", { name: "Limit to this project" }));

        await waitFor(() =>
          expect(screen.queryByRole("button", { name: "Limit to this project" })).toBeNull(),
        );
        expect(await screen.findByRole("alert")).toBeInTheDocument();
      });
    });
  });

  describe("when a saved connection is edited without retyping its secret", () => {
    let user: ReturnType<typeof userEvent.setup>;
    beforeEach(() => {
      user = userEvent.setup();
      state.connections = [connection()];
      renderDrawer({ connectionId: "conn-1" });
    });

    /** @scenario "Editing a connection without retyping its secret keeps the secret" */
    it("shows only the hint and sends no secret", async () => {
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
      await user.click(screen.getByRole("button", { name: "Replace" }));
      await user.type(screen.getByPlaceholderText("xoxb-…"), "xoxb-rotated");
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(state.updateCalls[0]).toMatchObject({ secret: "xoxb-rotated" });
    });
  });

  describe("when a connection automations deliver through is deleted", () => {
    /** @scenario "Deleting a connection in use is refused and names its automations" */
    it("is refused, names the claiming automations and keeps the connection", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      state.connections = [connection({ dependentAutomations: 2 })];
      state.deleteAnswers.push(
        handledError({
          code: "slack_connection_in_use",
          meta: {
            dependentAutomations: 2,
            claimants: [
              { id: "auto-1", label: "Errors to ops" },
              { id: "auto-2", label: "Daily digest" },
            ],
          },
        }),
      );
      renderDrawer({ connectionId: "conn-1", onClose });

      await user.click(screen.getByRole("button", { name: "Delete" }));

      expect(
        await screen.findByText("Used by 2 automations: Errors to ops, Daily digest"),
      ).toBeInTheDocument();
      expect(state.deleteCalls).toEqual([{ projectId: "project-1", id: "conn-1" }]);
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe("when a connection listed as unused turns out to be claimed", () => {
    /** @scenario "Deleting a connection in use is refused and names its automations" */
    it("closes the confirmation and names the claimants instead", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      state.connections = [connection({ dependentAutomations: 0 })];
      state.deleteAnswers.push(
        handledError({
          code: "slack_connection_in_use",
          meta: { dependentAutomations: 1, claimants: [{ id: "auto-1", label: "Errors to ops" }] },
        }),
      );
      renderDrawer({ connectionId: "conn-1", onClose });

      await user.click(screen.getByRole("button", { name: "Delete" }));
      await user.click(await screen.findByRole("button", { name: "Delete connection" }));

      expect(await screen.findByText("Used by 1 automation: Errors to ops")).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.queryByRole("button", { name: "Delete connection" })).toBeNull(),
      );
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe("when a connection nothing delivers through is deleted", () => {
    /** @scenario "Deleting an unused connection is confirmed too" */
    it("asks to confirm first, then deletes", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      state.connections = [connection({ dependentAutomations: 0 })];
      renderDrawer({ connectionId: "conn-1", onClose });

      await user.click(screen.getByRole("button", { name: "Delete" }));

      expect(
        await screen.findByText("Nothing uses it; its saved secret is removed."),
      ).toBeInTheDocument();
      expect(state.deleteCalls).toEqual([]);

      await user.click(screen.getByRole("button", { name: "Delete connection" }));

      await waitFor(() =>
        expect(state.deleteCalls).toEqual([{ projectId: "project-1", id: "conn-1" }]),
      );
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
