/**
 * @vitest-environment jsdom
 *
 * Settings > Secrets: what a reader sees, what a writer may do, and what a
 * refusal says.
 *
 * Moved from `platform/app/src/components/secrets/__tests__/SecretsSettingsPage.integration.test.tsx`,
 * which lived two directories away from the page it drove. The four cases it
 * carried travel; what is added here is the part the platform page did not
 * have — the four refusal codes this feature raises, which reached the customer
 * as "something went wrong on our side" because none of them is listed in the
 * presentation registry.
 *
 * THE CREDENTIAL PROPERTY IS ASSERTED, NOT ASSUMED: nothing rendered on this
 * page is a secret's value, and both inputs that take one are password fields.
 *
 * Spec: specs/secrets/secrets-manager.feature
 */

import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSecretHost, renderWithSecretHost } from "../../../testing";
import SecretsScreen from "../secrets.screen";

const { state } = vi.hoisted(() => ({
  state: {
    secrets: [] as Array<Record<string, unknown>>,
    isLoading: false,
    createRejectsWith: void 0 as unknown,
    deleteRejectsWith: void 0 as unknown,
  },
}));

const calls = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("../../../behavior/secret-api", () => ({
  secretApi: {
    useUtils: () => ({ secrets: { list: { invalidate: vi.fn() } } }),
    secrets: {
      list: { useQuery: () => ({ data: state.secrets, isLoading: state.isLoading }) },
      create: {
        useMutation: () => ({
          isPending: false,
          mutateAsync: async (input: unknown) => {
            calls.create(input);
            if (state.createRejectsWith) throw state.createRejectsWith;
            return {};
          },
        }),
      },
      update: {
        useMutation: () => ({
          isPending: false,
          mutateAsync: async (input: unknown) => {
            calls.update(input);
            return {};
          },
        }),
      },
      delete: {
        useMutation: () => ({
          isPending: false,
          mutateAsync: async (input: unknown) => {
            calls.remove(input);
            if (state.deleteRejectsWith) throw state.deleteRejectsWith;
            return {};
          },
        }),
      },
    },
  },
}));

vi.mock("@langwatch/design-system/page-layout", () => ({
  PageLayout: {
    HeaderButton: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
      <button onClick={onClick}>{children}</button>
    ),
  },
}));

function secretRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "secret-1",
    projectId: "proj-1",
    name: "OPENAI_API_KEY",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-02-01T00:00:00Z"),
    createdBy: { name: "Jane" },
    updatedBy: { name: "Jane" },
    ...overrides,
  };
}

/** A tRPC-shaped handled error, as the client sees one. */
function refusal(code: string) {
  return { data: { error: { code } } };
}

beforeEach(() => {
  state.secrets = [];
  state.isLoading = false;
  state.createRejectsWith = void 0;
  state.deleteRejectsWith = void 0;
  calls.create.mockClear();
  calls.update.mockClear();
  calls.remove.mockClear();
});

afterEach(() => cleanup());

describe("given the project has secrets", () => {
  beforeEach(() => {
    state.secrets = [secretRow(), secretRow({ id: "secret-2", name: "ANTHROPIC_API_KEY" })];
  });

  describe("when the page renders", () => {
    /** @scenario View secrets list */
    it("lists them by name, with who made each one", () => {
      renderWithSecretHost(<SecretsScreen />);
      expect(screen.getByText("OPENAI_API_KEY")).toBeInTheDocument();
      expect(screen.getByText("ANTHROPIC_API_KEY")).toBeInTheDocument();
      expect(screen.getAllByText("Jane")).toHaveLength(2);
    });

    /** @scenario View secrets list */
    it("titles itself", () => {
      renderWithSecretHost(<SecretsScreen />);
      expect(screen.getByRole("heading", { name: "Secrets" })).toBeInTheDocument();
    });

    /** @scenario A secret's value is never readable after it is stored */
    it("renders no value, and offers nothing that would reveal one", () => {
      const { container } = renderWithSecretHost(<SecretsScreen />);
      // The table has four columns and none of them is a value; there is no
      // reveal control anywhere on the page, and never has been. A stored
      // secret is replaced, not inspected.
      expect(screen.queryByRole("button", { name: /show|reveal/i })).toBeNull();
      expect(container.textContent).not.toContain("sk-");
    });
  });
});

describe("given the reader may manage secrets", () => {
  /** @scenario Add a secret */
  it("offers the Add Secret action", () => {
    renderWithSecretHost(<SecretsScreen />);
    expect(screen.getByRole("button", { name: /Add Secret/ })).toBeInTheDocument();
  });

  /** @scenario Add a secret */
  it("normalises the name as it is typed and sends the value once", async () => {
    const user = userEvent.setup();
    renderWithSecretHost(<SecretsScreen />);
    await user.click(screen.getByRole("button", { name: /Add Secret/ }));

    const name = await screen.findByPlaceholderText("e.g., OPENAI_API_KEY");
    await user.type(name, "my api-key 1");
    // Upper snake, because a code block reads these as environment variables.
    expect(name).toHaveValue("MYAPIKEY1");

    const value = screen.getByPlaceholderText("Enter secret value");
    // The one control that takes a credential is a password field.
    expect(value).toHaveAttribute("type", "password");
    await user.type(value, "sk-real-value");

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(calls.create).toHaveBeenCalledWith({
        projectId: "proj-1",
        name: "MYAPIKEY1",
        value: "sk-real-value",
      }),
    );
  });

  /** @scenario Update a secret's value */
  it("replaces a value through a password field, addressing the secret by id", async () => {
    const user = userEvent.setup();
    state.secrets = [secretRow()];
    renderWithSecretHost(<SecretsScreen />);

    await user.click(screen.getByRole("button", { name: "Actions for OPENAI_API_KEY" }));
    await user.click(await screen.findByRole("menuitem", { name: /Update Value/ }));

    const value = await screen.findByPlaceholderText("Enter new secret value");
    expect(value).toHaveAttribute("type", "password");
    await user.type(value, "sk-new-value");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(calls.update).toHaveBeenCalledWith({
        projectId: "proj-1",
        secretId: "secret-1",
        value: "sk-new-value",
      }),
    );
  });
});

describe("given the reader may only view secrets", () => {
  /** @scenario Permission gate on managing secrets */
  it("offers no Add action and no row menu", () => {
    state.secrets = [secretRow()];
    renderWithSecretHost(
      <SecretsScreen />,
      new FakeSecretHost({ grants: new Set(["secrets:view"]) }),
    );
    expect(screen.getByText("OPENAI_API_KEY")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add Secret/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Actions for/ })).toBeNull();
  });
});

describe("given no secrets exist", () => {
  /** @scenario Empty state */
  it("says so, and says what they are for", () => {
    renderWithSecretHost(<SecretsScreen />);
    expect(screen.getByText("No secrets configured")).toBeInTheDocument();
    expect(screen.getByText("Add secrets to use in code blocks")).toBeInTheDocument();
  });
});

describe("given a write is refused", () => {
  describe("when the name is already taken", () => {
    /** @scenario A refused secret write says why */
    it("says which name, not 'something went wrong on our side'", async () => {
      const user = userEvent.setup();
      state.createRejectsWith = refusal("secret_already_exists");
      const host = new FakeSecretHost();
      renderWithSecretHost(<SecretsScreen />, host);

      await user.click(screen.getByRole("button", { name: /Add Secret/ }));
      await user.type(await screen.findByPlaceholderText("e.g., OPENAI_API_KEY"), "OPENAI");
      await user.type(screen.getByPlaceholderText("Enter secret value"), "v");
      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(host.failures).toHaveLength(1));
      expect(host.failures[0]!.fallbackTitle).toBe("That name is already taken");
      expect(host.failures[0]!.description).toContain("already has a secret with that name");
      // The RAW error still travels: the words come from the code, never from
      // the wire message, which since #5984 is the code slug.
      expect(host.failures[0]!.error).toBe(state.createRejectsWith);
    });
  });

  describe("when the project is full", () => {
    /** @scenario A refused secret write says why */
    it("names the ceiling and what to do about it", async () => {
      const user = userEvent.setup();
      state.createRejectsWith = refusal("secret_limit_reached");
      const host = new FakeSecretHost();
      renderWithSecretHost(<SecretsScreen />, host);

      await user.click(screen.getByRole("button", { name: /Add Secret/ }));
      await user.type(await screen.findByPlaceholderText("e.g., OPENAI_API_KEY"), "OPENAI");
      await user.type(screen.getByPlaceholderText("Enter secret value"), "v");
      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(host.failures).toHaveLength(1));
      expect(host.failures[0]!.description).toMatch(/\d+ secrets/);
    });
  });

  describe("when the failure carries no code this feature knows", () => {
    /** @scenario A refused secret write says why */
    it("falls back to naming the action, and adds no invented sentence", async () => {
      const user = userEvent.setup();
      state.createRejectsWith = new Error("boom");
      const host = new FakeSecretHost();
      renderWithSecretHost(<SecretsScreen />, host);

      await user.click(screen.getByRole("button", { name: /Add Secret/ }));
      await user.type(await screen.findByPlaceholderText("e.g., OPENAI_API_KEY"), "OPENAI");
      await user.type(screen.getByPlaceholderText("Enter secret value"), "v");
      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(host.failures).toHaveLength(1));
      expect(host.failures[0]!.fallbackTitle).toBe("Couldn't create the secret");
      expect(host.failures[0]!.description).toBeUndefined();
    });
  });

  describe("when a secret is deleted twice", () => {
    /** @scenario A refused secret write says why */
    it("says it is already gone rather than reporting an internal failure", async () => {
      const user = userEvent.setup();
      state.secrets = [secretRow()];
      state.deleteRejectsWith = refusal("secret_not_found");
      const host = new FakeSecretHost();
      renderWithSecretHost(<SecretsScreen />, host);

      await user.click(screen.getByRole("button", { name: "Actions for OPENAI_API_KEY" }));
      await user.click(await screen.findByRole("menuitem", { name: /Delete Secret/ }));
      await user.click(await screen.findByRole("button", { name: "Delete" }));

      await waitFor(() => expect(host.failures).toHaveLength(1));
      expect(host.failures[0]!.fallbackTitle).toBe("That secret is no longer here");
    });
  });
});
