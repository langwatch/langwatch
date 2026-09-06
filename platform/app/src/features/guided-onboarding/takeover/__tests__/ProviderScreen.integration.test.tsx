/**
 * @vitest-environment jsdom
 *
 * The provider screen: one row of marks, one connect panel, the skip link.
 * The connect machinery and the Codex sign-in are mocked at their hooks;
 * what is under test is what the screen shows for each state.
 *
 * Spec: specs/features/onboarding/guided-welcome-takeover.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const emitMock = vi.fn();
vi.mock("react-contextual-analytics", () => ({
  useAnalytics: () => ({ emit: emitMock }),
}));

vi.mock("~/components/ui/color-mode", () => ({
  useColorModeValue: (light: unknown) => light,
}));

vi.mock("~/features/langy/hooks/useLangyExternalLinkGuard", () => ({
  langyFirstPartyLinkProps: {},
}));

const recordProviderMutate = vi.fn();
vi.mock("~/utils/api", () => ({
  api: {
    onboarding: {
      recordProvider: {
        useMutation: () => ({ mutate: recordProviderMutate }),
      },
    },
  },
}));

/**
 * The connect hook as the screen sees it: the credential values are real
 * state (so typing enables Connect), everything else comes from the
 * overrides a test sets before rendering.
 */
const connectOverrides: {
  status?: "idle" | "checking" | "saving" | "connected";
  error?: string;
  /** The values the form starts with, e.g. the mask for a server-side key. */
  values?: Record<string, string>;
  usesEnvironmentKey?: boolean;
} = {};
const connectSpy = vi.fn();
vi.mock("../useGuidedProviderConnect", () => ({
  useGuidedProviderConnect: (args: {
    provider: { kind: string; fields: { key: string; optional?: boolean }[] };
    onConnected: (c: unknown) => void;
  }) => {
    const [values, setValues] = useState<Record<string, string>>(
      connectOverrides.values ?? {},
    );
    const [model, setModel] = useState("gpt-5.2");
    const [manualModel, setManualModel] = useState("");
    const models =
      args.provider.kind === "api-key"
        ? ["gpt-5.2", "gpt-5-mini", "gpt-5.1", "gpt-4.1"]
        : [];
    const filled = args.provider.fields.every(
      (f) => f.optional || (values[f.key]?.length ?? 0) > 3,
    );
    const ready =
      filled &&
      (args.provider.kind === "manual" ? manualModel.length > 1 : true) &&
      (connectOverrides.status ?? "idle") === "idle";
    return {
      kind: args.provider.kind,
      isLoading: false,
      values,
      setField: (key: string, value: string) =>
        setValues((v) => ({ ...v, [key]: value })),
      models,
      model,
      setModel,
      manualModel,
      setManualModel,
      status: connectOverrides.status ?? "idle",
      ready,
      usesEnvironmentKey: connectOverrides.usesEnvironmentKey ?? false,
      error: connectOverrides.error,
      connect: async () => {
        connectSpy(values);
        args.onConnected({
          provider: "openai",
          model,
          kind: args.provider.kind,
        });
      },
    };
  },
}));

const codexState: {
  phase: Record<string, unknown>;
  begin: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
} = { phase: { name: "idle" }, begin: vi.fn(), cancel: vi.fn() };
let codexArgs: { onConnected?: () => void } = {};
vi.mock("~/components/settings/useCodexDeviceSignIn", () => ({
  useCodexDeviceSignIn: (args: { onConnected?: () => void }) => {
    codexArgs = args;
    return {
      phase: codexState.phase,
      begin: codexState.begin,
      cancel: codexState.cancel,
    };
  },
}));

import { providersForSurface } from "~/features/onboarding/regions/model-providers/providersForSurface";
import { MASKED_KEY_PLACEHOLDER } from "~/utils/constants";
import { ProviderScreen } from "../ProviderScreen";
import { guidedProvidersFor } from "../providers";

afterEach(cleanup);

function renderProvider({
  picksCount = 2,
  onConnected = vi.fn(),
  onSkip = vi.fn(),
}: {
  picksCount?: number;
  onConnected?: (c: unknown) => void;
  onSkip?: () => void;
} = {}) {
  const view = render(
    <ChakraProvider value={defaultSystem}>
      <ProviderScreen
        picksCount={picksCount}
        organizationId="org_1"
        projectId="proj_1"
        fading={false}
        onConnected={onConnected}
        onSkip={onSkip}
      />
    </ChakraProvider>,
  );
  act(() => {
    vi.advanceTimersByTime(20_000);
  });
  return { ...view, onConnected, onSkip };
}

const marks = () =>
  within(screen.getByRole("radiogroup", { name: "AI provider" })).getAllByRole(
    "radio",
  );
const mark = (name: string) =>
  within(screen.getByRole("radiogroup", { name: "AI provider" })).getByRole(
    "radio",
    { name },
  );
/**
 * Opens the skip dialog. The typing is done by now, and the dialog's
 * presence settles on real frames, so the clock goes back to real time.
 */
async function openSkipDialog() {
  vi.useRealTimers();
  fireEvent.click(screen.getByRole("button", { name: "Skip Guided Tour" }));
  return await screen.findByRole("dialog");
}
const dialogButton = (dialog: HTMLElement, name: string) =>
  within(dialog).getByRole("button", { name });

const pills = () =>
  within(
    screen.getByRole("radiogroup", { name: "Default chat model" }),
  ).getAllByRole("radio");

describe("ProviderScreen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    emitMock.mockReset();
    connectSpy.mockReset();
    recordProviderMutate.mockReset();
    delete connectOverrides.status;
    delete connectOverrides.error;
    delete connectOverrides.values;
    delete connectOverrides.usesEnvironmentKey;
    codexState.phase = { name: "idle" };
    codexState.begin = vi.fn();
    codexState.cancel = vi.fn();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when the screen opens", () => {
    /** @scenario Langy says "that up" for one pick and "those up" for several */
    it("says that up for one pick and those up for several", () => {
      const { unmount } = renderProvider({ picksCount: 1 });
      expect(screen.getByTestId("provider-line")).toHaveTextContent(
        "Awesome! I'll help you set that up. First, please connect an AI provider you have access to so we can keep talking.",
      );
      unmount();
      renderProvider({ picksCount: 2 });
      expect(screen.getByTestId("provider-line")).toHaveTextContent(
        "Awesome! I'll help you set those up.",
      );
      expect(emitMock).toHaveBeenCalledWith("viewed", "provider");
    });

    /** @scenario "The provider marks are one row with Codex first and preselected" */
    it("lists the marks in order with Codex selected and its sign-in offered", () => {
      renderProvider();
      expect(marks().map((m) => m.getAttribute("aria-label"))).toEqual([
        "Codex",
        "OpenAI",
        "Anthropic",
        "Gemini",
        "Azure",
        "Bedrock",
        "DeepSeek",
        "Groq",
        "Custom",
      ]);
      expect(mark("Codex")).toHaveAttribute("aria-checked", "true");
      expect(
        screen.getByRole("button", { name: "Sign in with ChatGPT" }),
      ).toBeInTheDocument();
    });
  });

  describe("when an API key provider is selected", () => {
    /** @scenario "An API key provider asks for the key and offers the default chat models" */
    it("asks for the key, recommends the first model and holds Connect until a key is typed", () => {
      renderProvider();
      fireEvent.click(mark("OpenAI"));
      expect(mark("OpenAI")).toHaveAttribute("aria-checked", "true");
      expect(emitMock).toHaveBeenCalledWith("selected", "provider", {
        provider: "openai",
      });

      const key = screen.getByLabelText("API key");
      expect(key).toHaveAttribute("type", "password");
      expect(key).toHaveAttribute("placeholder", "sk-...");

      const modelPills = pills();
      expect(modelPills).toHaveLength(4);
      expect(modelPills[0]).toHaveTextContent("gpt-5.2");
      expect(modelPills[0]).toHaveTextContent("recommended");
      expect(modelPills[0]).toHaveAttribute("aria-checked", "true");
      expect(modelPills[1]).not.toHaveTextContent("recommended");

      const connect = screen.getByRole("button", { name: /Connect/ });
      expect(connect).toBeDisabled();
      fireEvent.change(key, { target: { value: "sk-test-1234" } });
      expect(screen.getByRole("button", { name: /Connect/ })).toBeEnabled();
    });
  });

  describe("when a provider without a model list is selected", () => {
    /** @scenario "Azure, Bedrock and Custom take credentials and a typed model name" */
    it("asks for the credentials and a typed chat model, naming the provider in the hint", () => {
      renderProvider();
      fireEvent.click(mark("Azure"));
      expect(screen.getByLabelText("Endpoint")).toBeInTheDocument();
      expect(screen.getByLabelText("API key")).toBeInTheDocument();
      expect(screen.getByLabelText("Chat model")).toHaveAttribute(
        "placeholder",
        "your deployment name",
      );
      expect(
        screen.getByText(
          "Type it exactly as deployed: Azure has no model list we can read for you.",
        ),
      ).toBeInTheDocument();

      fireEvent.click(mark("Bedrock"));
      expect(screen.getByLabelText("Access key ID")).toBeInTheDocument();
      expect(screen.getByLabelText("Secret access key")).toBeInTheDocument();
      expect(screen.getByLabelText("Region")).toBeInTheDocument();
      expect(
        screen.getByText(
          /Type it exactly as deployed: Bedrock has no model list/,
        ),
      ).toBeInTheDocument();

      fireEvent.click(mark("Custom"));
      expect(screen.getByLabelText("Base URL")).toBeInTheDocument();
      expect(
        screen.getByText(
          /Type it exactly as deployed: Custom has no model list/,
        ),
      ).toBeInTheDocument();
    });
  });

  describe("when a key is connected", () => {
    /** @scenario "Connecting with a key checks it and then reports Connected" */
    it("reads Checking the key while checking and Connected once saved", () => {
      connectOverrides.status = "checking";
      const { unmount } = renderProvider();
      fireEvent.click(mark("OpenAI"));
      expect(
        screen.getByRole("button", { name: /Checking the key…/ }),
      ).toBeInTheDocument();
      unmount();

      connectOverrides.status = "connected";
      renderProvider();
      fireEvent.click(mark("OpenAI"));
      expect(
        screen.getByRole("button", { name: /^Connected$/ }),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("API key")).toBeDisabled();
    });

    it("hands the connection up and reports it without the key", () => {
      const { onConnected } = renderProvider();
      fireEvent.click(mark("OpenAI"));
      fireEvent.change(screen.getByLabelText("API key"), {
        target: { value: "sk-test-1234" },
      });
      fireEvent.click(screen.getByRole("button", { name: /Connect/ }));
      expect(connectSpy).toHaveBeenCalledWith({
        OPENAI_API_KEY: "sk-test-1234",
      });
      expect(onConnected).toHaveBeenCalledWith({
        provider: "openai",
        model: "gpt-5.2",
        kind: "api-key",
      });
      expect(emitMock).toHaveBeenCalledWith("connected", "provider", {
        provider: "openai",
        model: "gpt-5.2",
        kind: "api-key",
      });
      expect(JSON.stringify(emitMock.mock.calls)).not.toContain("sk-test");
    });
  });

  describe("when the server already carries the key", () => {
    /** @scenario A key already set on the server is used unless the user pastes their own */
    it("says so under the field and lets Connect use that key", () => {
      connectOverrides.values = { OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER };
      connectOverrides.usesEnvironmentKey = true;
      renderProvider();
      fireEvent.click(mark("OpenAI"));
      expect(screen.getByTestId("environment-key-hint")).toHaveTextContent(
        "This server already has a key for OpenAI. Connect to use it, or paste your own.",
      );
      expect(screen.getByRole("button", { name: /Connect/ })).toBeEnabled();
      fireEvent.change(screen.getByLabelText("API key"), {
        target: { value: "sk-mine-1234" },
      });
      expect(
        screen.queryByTestId("environment-key-hint"),
      ).not.toBeInTheDocument();
    });
  });

  describe("when the provider refuses the key", () => {
    /** @scenario "A rejected key shows the named error on the field" */
    it("shows the refusal under the key field", () => {
      connectOverrides.error = "OpenAI rejected this API key.";
      renderProvider();
      fireEvent.click(mark("OpenAI"));
      expect(screen.getByRole("alert")).toHaveTextContent(
        "OpenAI rejected this API key.",
      );
      expect(screen.getByRole("button", { name: /Connect/ })).toBeDisabled();
    });
  });

  describe("when the Codex sign-in is not approved in time", () => {
    /** @scenario "A Codex sign-in that times out says so and lets the user try again" */
    it("says the sign-in timed out and offers the sign-in again", () => {
      codexState.phase = {
        name: "error",
        message: "The sign-in timed out before it was approved.",
        timedOut: true,
      };
      renderProvider();
      expect(screen.getByRole("alert")).toHaveTextContent(
        "The sign-in timed out before it was approved.",
      );
      const again = screen.getByRole("button", {
        name: "Sign in with ChatGPT",
      });
      expect(again).toBeEnabled();
      fireEvent.click(again);
      expect(codexState.begin).toHaveBeenCalledTimes(1);
      expect(emitMock).toHaveBeenCalledWith("failed", "provider", {
        provider: "openai_codex",
        code: "codex_sign_in_timed_out",
      });
    });

    it("shows the one-time code while the approval is pending", () => {
      codexState.phase = {
        name: "pending",
        userCode: "ABCD-1234",
        verificationUrl: "https://auth.openai.com/device",
      };
      renderProvider();
      expect(screen.getByTestId("codex-pending")).toHaveTextContent(
        "ABCD-1234",
      );
      expect(
        screen.getByRole("button", { name: "Waiting for ChatGPT…" }),
      ).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(codexState.cancel).toHaveBeenCalledTimes(1);
    });

    it("records the Codex connection on the organization once signed in", () => {
      const { onConnected } = renderProvider();
      act(() => {
        codexArgs.onConnected?.();
      });
      expect(recordProviderMutate).toHaveBeenCalledWith(
        {
          organizationId: "org_1",
          provider: "openai_codex",
          model: expect.stringContaining("openai_codex/"),
        },
        expect.objectContaining({ onSettled: expect.any(Function) }),
      );
      const options = recordProviderMutate.mock.calls[0]?.[1] as {
        onSettled: () => void;
      };
      act(() => options.onSettled());
      expect(onConnected).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "openai_codex", kind: "oauth" }),
      );
    });
  });

  describe("when the user wants to skip the guide", () => {
    /** @scenario "Skip Guided Tour asks the user to confirm" */
    it("asks once, with the two choices", async () => {
      renderProvider();
      const dialog = await openSkipDialog();
      expect(emitMock).toHaveBeenCalledWith("clicked", "skip_tour");
      expect(dialog).toHaveAttribute("data-state", "open");
      expect(dialog).toHaveTextContent("Are you sure sure?");
      expect(dialog).toHaveTextContent(
        "It's much easier to get Langy to setup everything for you.",
      );
      expect(dialogButton(dialog, "Skip anyway")).toBeInTheDocument();
      expect(dialogButton(dialog, "Keep the guide")).toBeInTheDocument();
    });

    /** @scenario "Keep the guide closes the dialog" */
    it("keeps the guide and closes the dialog", async () => {
      const { onSkip } = renderProvider();
      const dialog = await openSkipDialog();
      fireEvent.click(dialogButton(dialog, "Keep the guide"));
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
      expect(onSkip).not.toHaveBeenCalled();
      expect(emitMock).toHaveBeenCalledWith("confirmed", "kept_guide");
      expect(screen.getByTestId("provider-panel")).toBeInTheDocument();
    });

    /** @scenario "Skip anyway records the skip and lands the user on the first pick" */
    it("hands the skip up when the user insists", async () => {
      const { onSkip } = renderProvider();
      const dialog = await openSkipDialog();
      fireEvent.click(dialogButton(dialog, "Skip anyway"));
      expect(onSkip).toHaveBeenCalledTimes(1);
      expect(emitMock).toHaveBeenCalledWith("confirmed", "skip_tour");
    });
  });

  describe("when the panel's inline model setup offers Codex", () => {
    /** @scenario "The takeover offers Codex wherever the panel's model setup does" */
    it("offers the same providers the panel's model setup offers, Codex included", () => {
      renderProvider();
      const names = marks().map((m) => m.getAttribute("aria-label"));
      const offeredToLangy = providersForSurface("langy").map((p) => p.key);
      expect(offeredToLangy).toContain("codex");
      expect(names).toContain("Codex");
      // One rule for both pickers: every mark points at a provider the
      // panel's inline model setup also lists.
      for (const provider of guidedProvidersFor()) {
        expect(offeredToLangy).toContain(provider.registryKey);
      }
    });
  });
});
