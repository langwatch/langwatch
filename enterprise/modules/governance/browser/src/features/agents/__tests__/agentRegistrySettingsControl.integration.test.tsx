// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The dormancy window control on the Agents page: it opens with the saved window, refuses a
 * value outside the allowed days and saves a new one. Only the tRPC binding is doubled.
 * Spec: enterprise/modules/governance/specs/cloud-agent-discovery.feature
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeGovernanceHost, renderWithGovernanceHost } from "../../../testing.tsx";
import {
  answerMutation,
  answerQuery,
  assertEveryCallConfigured,
  handledError,
  resetTrpcDouble,
  trpcDouble,
} from "../../kill-switch/__tests__/kill-switch-api-double.tsx";
import { AgentRegistrySettingsControl } from "../agent-registry-settings-control.tsx";

vi.mock("../../../behavior/governance-api.ts", async () =>
  (await import("../../kill-switch/__tests__/kill-switch-api-double.tsx")).governanceApiDouble(),
);

function renderControl() {
  renderWithGovernanceHost(<AgentRegistrySettingsControl organizationId="org-1" />, {
    host: fakeGovernanceHost(),
  });
}

const daysInput = () => screen.findByRole("spinbutton", { name: "Days without traces" });

beforeEach(() => {
  resetTrpcDouble();
});

afterEach(() => {
  assertEveryCallConfigured();
  cleanup();
});

describe("the dormancy window control", () => {
  /** @scenario "The dormancy window control says when the window did not load and reads it again" */
  it("offers Retry when the read fails and shows the window once it loads", async () => {
    let reads = 0;
    answerQuery("governanceRegistry.settings", () => {
      reads += 1;
      if (reads === 1) throw handledError({ code: "service_unavailable", httpStatus: 503 });
      return { dormant_after_days: 30 };
    });
    renderControl();

    await userEvent.click(await screen.findByTestId("dormancy-window-retry"));

    expect(await screen.findByTestId("dormancy-window-button")).toHaveTextContent(
      "Dormant after 30 days",
    );
    expect(reads).toBe(2);
  });

  /** @scenario "The dormancy window control opens with the saved window and saves a new one" */
  it("opens with the saved window and saves a new one", async () => {
    let saved = 30;
    answerQuery("governanceRegistry.settings", () => ({ dormant_after_days: saved }));
    answerQuery("governanceAgents.list", () => []);
    answerMutation("governanceRegistry.saveSettings", (input) => {
      saved = (input as { dormant_after_days: number }).dormant_after_days;
      return { dormant_after_days: saved };
    });
    renderControl();

    await userEvent.click(await screen.findByTestId("dormancy-window-button"));
    const input = await daysInput();
    expect(input).toHaveValue(30);
    await userEvent.clear(input);
    await userEvent.type(input, "14");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(trpcDouble.calls).toEqual([
      {
        procedure: "governanceRegistry.saveSettings",
        input: { organizationId: "org-1", dormant_after_days: 14 },
      },
    ]);
    expect(await screen.findByTestId("dormancy-window-button")).toHaveTextContent(
      "Dormant after 14 days",
    );
    await waitFor(() =>
      expect(screen.queryByRole("spinbutton", { name: "Days without traces" })).toBeNull(),
    );
    expect(trpcDouble.invalidated).toEqual(
      expect.arrayContaining(["governanceRegistry.settings", "governanceAgents.list"]),
    );
  });

  /** @scenario "The dormancy window control refuses a window outside 1 to 365 days" */
  it("refuses a window outside 1 to 365 days and sends nothing", async () => {
    answerQuery("governanceRegistry.settings", () => ({ dormant_after_days: 30 }));
    renderControl();

    await userEvent.click(await screen.findByTestId("dormancy-window-button"));
    const input = await daysInput();
    await userEvent.clear(input);
    await userEvent.type(input, "400");

    expect(screen.getByTestId("dormancy-window-error")).toHaveTextContent(
      "Enter a whole number from 1 to 365.",
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.type(input, "{Enter}");
    expect(trpcDouble.calls).toEqual([]);
  });
});
