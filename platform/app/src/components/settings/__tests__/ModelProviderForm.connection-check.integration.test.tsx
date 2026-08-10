/**
 * @vitest-environment jsdom
 *
 * The credential check offered inside the model-provider drawer, exercised
 * through the real form tree.
 *
 * Covers @unit scenarios from specs/model-providers/credential-validation.feature.
 *
 * Only the boundaries are stubbed — the tRPC client, the drawer, org context,
 * feature flags, the toaster. Everything that decides whether the control is
 * shown, usable, and about which settings is the real code: the visibility
 * rule reads the registry, the usability rule runs the provider's own schema,
 * and which route the click takes is settled by the same helpers the save path
 * uses. Mocking any of those would leave the test asserting its own fixtures.
 */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockMutateAsync,
  mockGetAllForProjectForFrontendQuery,
  mockListAllForOrganizationForFrontendQuery,
  mockListAllForProjectForFrontendQuery,
  mockTestConnection,
  mockValidateApiKeyMutation,
} = vi.hoisted(() => ({
  mockMutateAsync: vi.fn().mockResolvedValue({}),
  mockGetAllForProjectForFrontendQuery: vi.fn(),
  mockListAllForOrganizationForFrontendQuery: vi.fn(),
  mockListAllForProjectForFrontendQuery: vi.fn(),
  mockTestConnection: vi.fn(),
  mockValidateApiKeyMutation: vi.fn(),
}));

vi.mock("../../../utils/api", () => ({
  api: {
    modelProvider: {
      getAllForProjectForFrontend: {
        useQuery: mockGetAllForProjectForFrontendQuery,
      },
      listAllForOrganizationForFrontend: {
        useQuery: mockListAllForOrganizationForFrontendQuery,
      },
      listAllForProjectForFrontend: {
        useQuery: mockListAllForProjectForFrontendQuery,
      },
      update: { useMutation: () => ({ mutateAsync: mockMutateAsync }) },
      testConnection: {
        useMutation: () => ({ mutateAsync: mockTestConnection }),
      },
      validateApiKey: {
        useMutation: () => ({ mutateAsync: mockValidateApiKeyMutation }),
      },
      setRoleAssignmentForScope: {
        useMutation: () => ({
          mutateAsync: vi.fn().mockResolvedValue({ ok: true }),
        }),
      },
      isManagedProvider: { useQuery: () => ({ data: { managed: false } }) },
    },
    useContext: () => ({
      organization: { getAll: { invalidate: vi.fn() } },
      modelProvider: {
        getAllForProject: { invalidate: vi.fn() },
        getAllForProjectForFrontend: { invalidate: vi.fn() },
        listAllForProjectForFrontend: { invalidate: vi.fn() },
        listAllForOrganizationForFrontend: { invalidate: vi.fn() },
        getResolvedDefault: { invalidate: vi.fn() },
        getDefaultModelsForProject: { invalidate: vi.fn() },
      },
    }),
  },
}));

vi.mock("../../../hooks/useDrawer", () => ({
  useDrawer: () => ({ closeDrawer: vi.fn(), openDrawer: vi.fn() }),
}));

vi.mock("../../../hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", name: "Web App", slug: "web-app" },
    team: { id: "team-1", name: "Platform" },
    organization: {
      id: "org-1",
      name: "Acme",
      teams: [
        {
          id: "team-1",
          name: "Platform",
          projects: [{ id: "proj-1", name: "Web App" }],
        },
      ],
    },
    hasPermission: () => true,
  }),
}));

vi.mock("../../../hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: false, isLoading: false }),
}));

vi.mock("../../ui/toaster", () => ({ toaster: { create: vi.fn() } }));

import { MASKED_KEY_PLACEHOLDER } from "../../../utils/constants";
import { EditModelProviderForm } from "../ModelProviderForm";
import {
  inputFor,
  keyedRow,
  makePrimeQueries,
  Wrapper,
} from "./modelProviderDrawerHarness";

const primeQueries = makePrimeQueries({
  collapsedQuery: mockGetAllForProjectForFrontendQuery,
  organizationListQuery: mockListAllForOrganizationForFrontendQuery,
  projectListQuery: mockListAllForProjectForFrontendQuery,
});

const renderDrawer = (props: {
  modelProviderId?: string;
  providerKey?: string;
}) =>
  render(
    <Wrapper>
      <EditModelProviderForm
        projectId="proj-1"
        organizationId="org-1"
        providerKey={props.providerKey ?? "openai"}
        modelProviderId={props.modelProviderId}
      />
    </Wrapper>,
  );

const checkButton = () =>
  screen.queryByRole("button", { name: "Test connection" });

const works = { outcome: "verified" as const, valid: true as const };

beforeEach(() => {
  vi.clearAllMocks();
  mockMutateAsync.mockResolvedValue({});
  mockTestConnection.mockResolvedValue(works);
  mockValidateApiKeyMutation.mockResolvedValue(works);
});

afterEach(cleanup);

describe("Feature: checking a credential from the drawer it was typed into", () => {
  describe("given a provider whose credentials cannot be probed", () => {
    beforeEach(() => {
      primeQueries([]);
      // Bedrock signs with AWS credentials, which no models listing
      // exercises. Filling every field in cannot make it checkable.
      renderDrawer({ modelProviderId: "new", providerKey: "bedrock" });
    });

    /** @scenario "A provider that cannot be checked offers no control" */
    it("offers no way to check the connection at all", () => {
      expect(checkButton()).toBeNull();
    });

    it("says nothing about the connection working", () => {
      expect(screen.queryByText("Connection works")).toBeNull();
    });
  });

  describe("given a provider that can be checked, with nothing filled in", () => {
    beforeEach(() => {
      primeQueries([]);
      renderDrawer({ modelProviderId: "new", providerKey: "openai" });
    });

    /** @scenario "Checking is unavailable until the credential is complete" */
    it("offers the control but will not let it be used", () => {
      expect(checkButton()).not.toBeNull();
      expect(checkButton()).toBeDisabled();
    });

    describe("when the credential is entered", () => {
      it("becomes usable", async () => {
        await userEvent.type(inputFor("OPENAI_API_KEY"), "sk-typed-just-now");

        await waitFor(() => expect(checkButton()).toBeEnabled());
      });
    });
  });

  describe("given a provider that accepts a project and location together or not at all", () => {
    beforeEach(() => {
      primeQueries([]);
      renderDrawer({ modelProviderId: "new", providerKey: "gemini" });
    });

    describe("when only half the pair is filled in", () => {
      /** @scenario "A credential the provider's own rules reject cannot be checked" */
      it("stays unusable", async () => {
        // Every *required* field is satisfied here — the project and location
        // are both optional on their own. Only the provider's own schema knows
        // that one without the other is not a credential, which is why the rule
        // asks the schema rather than counting empty required fields.
        await userEvent.type(inputFor("GEMINI_API_KEY"), "a-real-key");
        await userEvent.type(inputFor("GEMINI_PROJECT"), "my-project");

        await waitFor(() => expect(checkButton()).toBeDisabled());
      });
    });

    it("becomes usable when the pair is completed", async () => {
      await userEvent.type(inputFor("GEMINI_API_KEY"), "a-real-key");
      await userEvent.type(inputFor("GEMINI_PROJECT"), "my-project");
      await userEvent.type(inputFor("GEMINI_LOCATION"), "us-central1");

      await waitFor(() => expect(checkButton()).toBeEnabled());
    });
  });

  describe("given a saved provider I have not edited", () => {
    beforeEach(() => {
      primeQueries([
        keyedRow({
          providerKey: "openai",
          apiKey: "OPENAI_API_KEY",
          baseUrl: "OPENAI_BASE_URL",
          storedBaseUrl: "https://saved.example.com/v1",
        }),
      ]);
      renderDrawer({ modelProviderId: "row-openai", providerKey: "openai" });
    });

    describe("when I check the connection", () => {
      /** @scenario "An unchanged provider is still checked against what is stored" */
      it("checks the stored credential without asking for it again", async () => {
        await userEvent.click(checkButton()!);

        await waitFor(() => expect(mockTestConnection).toHaveBeenCalled());
        const [sent] = mockTestConnection.mock.calls[0]!;
        // No settings travel with the call, so the server reads the row. This
        // is the only way to check a key the form deliberately never shows.
        expect(sent.customKeys).toBeUndefined();
        expect(sent.modelProviderId).toBe("row-openai");
      });

      it("reports the verdict where the customer is looking", async () => {
        await userEvent.click(checkButton()!);

        expect(await screen.findByText("Connection works")).toBeTruthy();
      });
    });
  });

  describe("given a saved provider whose endpoint I have changed", () => {
    beforeEach(() => {
      primeQueries([
        keyedRow({
          providerKey: "openai",
          apiKey: "OPENAI_API_KEY",
          baseUrl: "OPENAI_BASE_URL",
          storedBaseUrl: "https://saved.example.com/v1",
        }),
      ]);
      renderDrawer({ modelProviderId: "row-openai", providerKey: "openai" });
    });

    describe("when I enter the credential again and check", () => {
      /** @scenario "Checking after changing an endpoint uses the endpoint on screen" */
      it("checks the endpoint on screen", async () => {
        await userEvent.clear(inputFor("OPENAI_BASE_URL"));
        await userEvent.type(
          inputFor("OPENAI_BASE_URL"),
          "https://new.example.com/v1",
        );
        await userEvent.clear(inputFor("OPENAI_API_KEY"));
        await userEvent.type(inputFor("OPENAI_API_KEY"), "sk-typed-just-now");

        await userEvent.click(checkButton()!);

        await waitFor(() => expect(mockTestConnection).toHaveBeenCalled());
        const [sent] = mockTestConnection.mock.calls[0]!;
        expect(sent.customKeys?.OPENAI_BASE_URL).toBe(
          "https://new.example.com/v1",
        );
        expect(sent.customKeys?.OPENAI_API_KEY).toBe("sk-typed-just-now");
      });
    });

    describe("when I check without re-entering the credential", () => {
      /** @scenario "Changing an endpoint without the credential asks for the credential" */
      it("asks for the credential rather than reaching for the stored one", async () => {
        // The server refuses to pair a stored secret with an address from the
        // request, so a masked credential comes back unchecked. What the
        // customer needs is the next step, not an apology about storage.
        mockTestConnection.mockResolvedValue({
          outcome: "unchecked",
          valid: true,
          reason: "credential_masked",
        });

        await userEvent.clear(inputFor("OPENAI_BASE_URL"));
        await userEvent.type(
          inputFor("OPENAI_BASE_URL"),
          "https://new.example.com/v1",
        );

        await userEvent.click(checkButton()!);

        expect(
          await screen.findByText(
            "Enter the credential again to check these settings.",
          ),
        ).toBeTruthy();

        const [sent] = mockTestConnection.mock.calls[0]!;
        expect(sent.customKeys?.OPENAI_API_KEY).toBe(MASKED_KEY_PLACEHOLDER);
      });
    });
  });

  describe("given a provider I am creating", () => {
    beforeEach(() => {
      primeQueries([]);
      renderDrawer({ modelProviderId: "new", providerKey: "openai" });
    });

    describe("when I check the credential I have typed", () => {
      /** @scenario "Checking does not save" */
      it("checks it without creating the provider", async () => {
        await userEvent.type(inputFor("OPENAI_API_KEY"), "sk-typed-just-now");
        await userEvent.click(checkButton()!);

        await waitFor(() =>
          expect(mockValidateApiKeyMutation).toHaveBeenCalled(),
        );
        expect(mockMutateAsync).not.toHaveBeenCalled();
      });

      it("says what is still left to do, so a pass does not read as a save", async () => {
        await userEvent.type(inputFor("OPENAI_API_KEY"), "sk-typed-just-now");
        await userEvent.click(checkButton()!);

        expect(
          await screen.findByText("Save to finish adding this provider."),
        ).toBeTruthy();
      });
    });

    /** @scenario "A result disappears when I change the credential" */
    it("drops the verdict as soon as the credential changes", async () => {
      await userEvent.type(inputFor("OPENAI_API_KEY"), "sk-typed-just-now");
      await userEvent.click(checkButton()!);
      expect(await screen.findByText("Connection works")).toBeTruthy();

      await userEvent.type(inputFor("OPENAI_API_KEY"), "-edited");

      await waitFor(() =>
        expect(screen.queryByText("Connection works")).toBeNull(),
      );
    });

    /** @scenario "A result still in flight when I change the credential is discarded" */
    it("discards an answer that arrives after the credential has changed", async () => {
      // The case the test above cannot reach, because a resolved mock lands
      // before the edit. Here the answer is held open across the edit, which is
      // where the guard either works or silently does nothing: a verdict about
      // the previous credential reappearing is a success claim about a key that
      // is no longer on screen.
      let answer: (value: unknown) => void = () => undefined;
      mockValidateApiKeyMutation.mockImplementation(
        () => new Promise((resolve) => (answer = resolve)),
      );

      await userEvent.type(inputFor("OPENAI_API_KEY"), "sk-typed-just-now");
      await userEvent.click(checkButton()!);
      expect(await screen.findByText("Testing…")).toBeTruthy();

      await userEvent.type(inputFor("OPENAI_API_KEY"), "-edited");

      await act(async () => {
        answer({ outcome: "verified", valid: true });
        await Promise.resolve();
      });

      expect(screen.queryByText("Connection works")).toBeNull();
    });
  });
});
