/**
 * The approval page's actions on a phone-width viewport, measured in a real engine: jsdom
 * reports zero for every box, so only here can Approve and Deny be compared by height.
 * Spec: login-user-scoped-key.feature
 */

import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithApiKeyHost } from "../../../testing.tsx";
import CliAuthScreen from "../cli-auth-screen.tsx";
import { cliAuthState as state, resetCliAuthState } from "./support/cli-auth-doubles.tsx";
import { hostFor } from "./support/cli-auth-fixtures.ts";

vi.mock("../../../behavior/use-grantable-permissions.ts", async () =>
  (await import("./support/cli-auth-doubles.tsx")).grantablePermissionsModule(),
);
vi.mock("../../../behavior/api-key-api.ts", async () =>
  (await import("./support/cli-auth-doubles.tsx")).apiKeyApiModule(),
);
vi.mock("@langwatch/trace-client", async () =>
  (await import("./support/cli-auth-doubles.tsx")).traceClientModule(),
);
vi.mock("@langwatch/design-system/scope-chip-picker", async () =>
  (await import("./support/cli-auth-doubles.tsx")).scopeChipPickerModule(),
);

beforeEach(() => {
  resetCliAuthState();
});

afterEach(() => cleanup());

function heightOf(name: string): number {
  return screen.getByRole("button", { name }).getBoundingClientRect().height;
}

describe("given a pending device code on a phone", () => {
  /** @scenario the primary action and Deny are the same height on a phone */
  it("draws Confirm, then Approve, as tall as Deny while the actions stack", async () => {
    const user = userEvent.setup();
    state.bindings = [{ scopeType: "ORGANIZATION", scopeId: "org-1", role: "ADMIN" }];
    renderWithApiKeyHost(<CliAuthScreen />, hostFor());

    const confirm = await screen.findByRole("button", { name: "Confirm" });
    expect(window.innerWidth).toBeLessThan(480);
    expect(heightOf("Confirm")).toBeGreaterThan(0);
    expect(heightOf("Confirm")).toBe(heightOf("Deny"));

    await user.click(confirm);
    await screen.findByRole("button", { name: "Approve" });
    expect(heightOf("Approve")).toBeGreaterThan(0);
    expect(heightOf("Approve")).toBe(heightOf("Deny"));
  });
});
