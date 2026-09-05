/**
 * @vitest-environment jsdom
 *
 * What the takeover reports: every step names the screen, the paths and the
 * provider, and no event ever carries the key that was typed.
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

vi.mock("~/utils/api", () => ({
  api: {
    onboarding: {
      recordProvider: { useMutation: () => ({ mutate: vi.fn() }) },
    },
  },
}));

vi.mock("~/components/settings/useCodexDeviceSignIn", () => ({
  useCodexDeviceSignIn: () => ({
    phase: { name: "idle" },
    begin: vi.fn(),
    cancel: vi.fn(),
  }),
}));

const SECRET = "sk-secret-key-9876";

vi.mock("../useGuidedProviderConnect", () => ({
  useGuidedProviderConnect: (args: {
    provider: { kind: string; fields: { key: string }[] };
    onConnected: (c: unknown) => void;
    onFailed: (f: unknown) => void;
  }) => {
    const [values, setValues] = useState<Record<string, string>>({});
    const ready = args.provider.fields.every(
      (f) => (values[f.key]?.length ?? 0) > 3,
    );
    return {
      kind: args.provider.kind,
      isLoading: false,
      values,
      setField: (key: string, value: string) =>
        setValues((v) => ({ ...v, [key]: value })),
      models: ["gpt-5.2", "gpt-5-mini"],
      model: "gpt-5.2",
      setModel: vi.fn(),
      manualModel: "",
      setManualModel: vi.fn(),
      status: "idle",
      ready,
      error: undefined,
      connect: async () => {
        if (values.OPENAI_API_KEY === SECRET) {
          args.onConnected({
            provider: "openai",
            model: "gpt-5.2",
            kind: "api-key",
          });
        } else {
          args.onFailed({ provider: "openai", code: "credential_refused" });
        }
      },
    };
  },
}));

import { HelloScreen } from "../HelloScreen";
import { ProviderScreen } from "../ProviderScreen";
import { ValueScreen } from "../ValueScreen";

afterEach(cleanup);

const settle = () =>
  act(() => {
    vi.advanceTimersByTime(20_000);
  });

const wrap = (node: React.ReactNode) => (
  <ChakraProvider value={defaultSystem}>{node}</ChakraProvider>
);

describe("the takeover's analytics", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    emitMock.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when the user goes through hello, value and provider", () => {
    /** @scenario "The takeover reports its steps without ever carrying a key" */
    it("reports each step with its screen, paths and provider, and never the key", () => {
      const hello = render(
        wrap(
          <HelloScreen firstName="Rogerio" fading={false} onNext={vi.fn()} />,
        ),
      );
      settle();
      fireEvent.click(screen.getByTestId("takeover-next"));
      hello.unmount();

      const value = render(
        wrap(
          <ValueScreen
            firstName="Rogerio"
            target="ACME"
            fading={false}
            onNext={vi.fn()}
          />,
        ),
      );
      settle();
      fireEvent.click(screen.getByRole("button", { name: "Gateway" }));
      fireEvent.click(screen.getByRole("button", { name: "Governance" }));
      fireEvent.click(screen.getByRole("button", { name: "Gateway" }));
      fireEvent.click(screen.getByTestId("takeover-next"));
      value.unmount();

      render(
        wrap(
          <ProviderScreen
            picksCount={1}
            organizationId="org_1"
            projectId="proj_1"
            codexAvailable
            fading={false}
            onConnected={vi.fn()}
            onSkip={vi.fn()}
          />,
        ),
      );
      settle();
      fireEvent.click(screen.getByRole("radio", { name: "OpenAI" }));
      const key = screen.getByLabelText("API key");
      fireEvent.change(key, { target: { value: "sk-wrong-key-1234" } });
      fireEvent.click(screen.getByRole("button", { name: /Connect/ }));
      fireEvent.change(key, { target: { value: SECRET } });
      fireEvent.click(screen.getByRole("button", { name: /Connect/ }));
      fireEvent.click(screen.getByRole("button", { name: "Skip Guided Tour" }));

      const events = emitMock.mock.calls.map(([action, name, attrs]) => ({
        action,
        name,
        attrs,
      }));
      expect(events).toEqual(
        expect.arrayContaining([
          { action: "viewed", name: "hello", attrs: undefined },
          { action: "clicked", name: "next", attrs: { screen: "hello" } },
          { action: "viewed", name: "value", attrs: undefined },
          {
            action: "selected",
            name: "path",
            attrs: { path: "gateway", order: 1 },
          },
          {
            action: "selected",
            name: "path",
            attrs: { path: "governance", order: 2 },
          },
          { action: "deselected", name: "path", attrs: { path: "gateway" } },
          {
            action: "clicked",
            name: "next",
            attrs: { screen: "value", paths: ["governance"] },
          },
          { action: "viewed", name: "provider", attrs: undefined },
          {
            action: "selected",
            name: "provider",
            attrs: { provider: "openai" },
          },
          {
            action: "failed",
            name: "provider",
            attrs: { provider: "openai", code: "credential_refused" },
          },
          {
            action: "connected",
            name: "provider",
            attrs: { provider: "openai", model: "gpt-5.2", kind: "api-key" },
          },
          { action: "clicked", name: "skip_tour", attrs: undefined },
        ]),
      );

      const everything = JSON.stringify(emitMock.mock.calls);
      expect(everything).not.toContain(SECRET);
      expect(everything).not.toContain("sk-wrong");
    });
  });
});
