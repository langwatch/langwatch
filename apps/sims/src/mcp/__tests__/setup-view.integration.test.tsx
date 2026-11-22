// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { statusSchema } from "../mcp-api.ts";
import { SetupView } from "../setup-view.tsx";
import { wireStatus } from "./fake-sim.ts";

const refresh = async () => undefined;

describe("SetupView", () => {
  afterEach(() => cleanup());

  /** @scenario "The setup view shows the target, the masked key and the grant" */
  it("shows the target, the masked key and the connected grant", () => {
    render(<SetupView status={statusSchema.parse(wireStatus)} refresh={refresh} />);

    expect(screen.getByText("sk-lw-…-key (from MCPSIM_API_KEY)")).toBeTruthy();
    expect(screen.getByText("http://localhost:5598/callback")).toBeTruthy();
    expect(screen.getByText("connected")).toBeTruthy();
    expect(screen.getByText("client_1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Forget" })).toHaveProperty("disabled", false);
  });

  /** @scenario "The setup view offers an OAuth connect when there is no grant" */
  it("offers Connect OAuth and no Forget when there is no grant", () => {
    const status = statusSchema.parse({ ...wireStatus, oauth: { connected: false, refreshes: 0 } });
    render(<SetupView status={status} refresh={refresh} />);

    expect(screen.getByText("No grant")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect OAuth" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Forget" })).toHaveProperty("disabled", true);
  });
});
