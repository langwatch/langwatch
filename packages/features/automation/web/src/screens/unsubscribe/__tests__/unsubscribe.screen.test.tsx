/**
 * @vitest-environment jsdom
 *
 * The unsubscribe landing: what a recipient is offered, and what each choice
 * silences.
 *
 * THE PLATFORM PAGE HAD NO SUITE. Nothing mounted it, so nothing asserted the
 * three decisions it makes — that a link with no token or a token the server
 * refuses is a dead end rather than a spinner, that the per-notification choice
 * is only offered when the link names a notification, and that each button
 * confirms the scope it says it does. The last is the one that matters: getting
 * it backwards silences everything from a project for somebody who asked to
 * stop one alert.
 *
 * Spec: specs/automations/unsubscribe-landing.feature
 */

import { cleanup, screen } from "@testing-library/react";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import UnsubscribeScreen from "../unsubscribe.screen";

const { state } = vi.hoisted(() => ({
  state: {
    view: undefined as Record<string, unknown> | undefined,
    isLoading: false,
    isError: false,
  },
}));

const calls = vi.hoisted(() => ({
  resolve: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock("../../../behavior/automation-api", () => ({
  automationApi: {
    emailSuppression: {
      resolveUnsubscribeToken: {
        useQuery: (input: unknown, options: unknown) => {
          calls.resolve(input, options);
          return { data: state.view, isLoading: state.isLoading, isError: state.isError };
        },
      },
      confirmUnsubscribe: {
        useMutation: () => ({
          isPending: false,
          mutate: (input: unknown, perCall?: { onSuccess?: () => void }) => {
            calls.confirm(input);
            perCall?.onSuccess?.();
          },
        }),
      },
    },
  },
}));

function renderScreen(token: string) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <UnsubscribeScreen token={token} />
    </ChakraProvider>,
  );
}

beforeEach(() => {
  state.view = { projectName: "Acme Support", triggerName: "Bad answer alert", email: "a***@acme.io" };
  state.isLoading = false;
  state.isError = false;
  calls.resolve.mockClear();
  calls.confirm.mockClear();
});

afterEach(() => cleanup());

describe("given a link the server recognises", () => {
  /** @scenario The unsubscribe link offers both scopes it promises */
  it("offers the one notification and the whole project, naming both", () => {
    renderScreen("tok_1");

    expect(screen.getByRole("button", { name: "Stop receiving Bad answer alert" })).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Stop all notifications from Acme Support" }),
    ).toBeDefined();
  });

  /** @scenario Stopping one notification does not silence the project */
  it("confirms the trigger scope, and says which notification stopped", async () => {
    const user = userEvent.setup();
    renderScreen("tok_1");

    await user.click(screen.getByRole("button", { name: "Stop receiving Bad answer alert" }));

    expect(calls.confirm).toHaveBeenCalledWith({ token: "tok_1", scope: "trigger" });
    expect(
      screen.getByText("a***@acme.io will no longer receive Bad answer alert."),
    ).toBeDefined();
  });

  /** @scenario Stopping the project silences every notification from it */
  it("confirms the project scope, and says the project stopped", async () => {
    const user = userEvent.setup();
    renderScreen("tok_1");

    await user.click(
      screen.getByRole("button", { name: "Stop all notifications from Acme Support" }),
    );

    expect(calls.confirm).toHaveBeenCalledWith({ token: "tok_1", scope: "project" });
    expect(
      screen.getByText("a***@acme.io will no longer receive notifications from Acme Support."),
    ).toBeDefined();
  });
});

describe("given a link that names no particular notification", () => {
  beforeEach(() => {
    state.view = { projectName: "Acme Support", triggerName: null, email: "a***@acme.io" };
  });

  /** @scenario A link with no notification offers only the project scope */
  it("offers the project scope alone", () => {
    renderScreen("tok_1");

    expect(
      screen.getByRole("button", { name: "Stop all notifications from Acme Support" }),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: /Stop receiving/ })).toBeNull();
  });
});

describe("given a link the server refuses", () => {
  beforeEach(() => {
    state.view = void 0;
    state.isError = true;
  });

  /** @scenario An invalid or expired unsubscribe link is a dead end */
  it("says the link is not valid, and offers nothing to confirm", () => {
    renderScreen("tok_dead");

    expect(screen.getByText("Link not valid")).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("given an address with no token at all", () => {
  /** @scenario An invalid or expired unsubscribe link is a dead end */
  it("says the link is not valid without asking the server anything", () => {
    renderScreen("");

    expect(screen.getByText("Link not valid")).toBeDefined();
    expect(calls.resolve).toHaveBeenCalledWith({ token: "" }, { enabled: false, retry: false });
  });
});

describe("given the server has not answered yet", () => {
  beforeEach(() => {
    state.view = void 0;
    state.isLoading = true;
  });

  /** @scenario A recipient waits rather than being told the link is dead */
  it("waits rather than calling a link it has not heard about dead", () => {
    renderScreen("tok_1");

    expect(screen.getByTestId("unsubscribe-loading")).toBeDefined();
    expect(screen.queryByText("Link not valid")).toBeNull();
  });
});
