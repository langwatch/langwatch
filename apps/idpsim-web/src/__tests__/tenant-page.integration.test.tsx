// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TenantPage } from "../tenant-page.tsx";
import { fakeSimulator, tenantOne } from "./fake-simulator.ts";

beforeEach(() => window.history.replaceState(null, "", "/t/1/"));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a tenant's page", () => {
  /** @scenario "Registering an application hands back what the setup wizard asks for" */
  it("registers an application and shows the issuer, client id and secret to paste back", async () => {
    const app = {
      clientId: "idpsim-t1-abc",
      clientSecret: "s3cret",
      name: "LangWatch",
      redirectUris: ["https://app.example/cb/{connection}"],
      createdAt: "2026-09-28T10:00:00Z",
    };
    const { sent } = fakeSimulator({
      routes: {
        "GET /api/t/1": { body: tenantOne },
        "POST /api/t/1/apps": { status: 201, body: app },
      },
    });
    render(<TenantPage nav={null} tenantId={1} />);
    await screen.findByText("Register an application");
    expect(screen.getByText(/\{connection\} segment matches/u)).toBeTruthy();

    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "LangWatch" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Redirect addresses" }), {
      target: { value: "https://app.example/cb/{connection}\n" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Register" }));

    expect(await screen.findByText("LangWatch is registered")).toBeTruthy();
    expect(screen.getAllByText("idpsim-t1-abc").length).toBeGreaterThan(0);
    expect(screen.getAllByText("s3cret").length).toBeGreaterThan(0);
    expect(screen.getAllByText("http://idp.test/t/1").length).toBeGreaterThan(0);
    expect(sent.find((request) => request.method === "POST")?.body).toEqual({
      name: "LangWatch",
      redirectUris: ["https://app.example/cb/{connection}", ""],
      entityId: "",
      acsUrl: "",
    });
  });

  it("shows a refusal beside the form that caused it, in the simulator's words", async () => {
    fakeSimulator({
      routes: {
        "GET /api/t/1": { body: tenantOne },
        "PUT /api/t/1/provisioning": {
          status: 400,
          body: {
            title: "That is this tenant's token, not LangWatch's",
            detail: "The token above guards the simulator's own directory.",
            hint: "Take the value from LangWatch's SCIM setup instead.",
          },
        },
      },
    });
    window.history.replaceState(null, "", "/t/1/#provisioning");
    render(<TenantPage nav={null} tenantId={1} />);
    await screen.findByText("Provision into LangWatch");

    fireEvent.change(screen.getByRole("textbox", { name: "SCIM address" }), {
      target: { value: "https://app.example/api/scim/v2" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Token" }), {
      target: { value: "idpsim-scim-token-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    expect(await screen.findByText("That is this tenant's token, not LangWatch's")).toBeTruthy();
  });

  it("opens the tab named in the address and says when the tenant does not exist", async () => {
    fakeSimulator({
      routes: {
        "GET /api/t/9": {
          status: 404,
          body: {
            title: "There is no tenant 9",
            detail: "This simulator serves tenants 1 to 3.",
            hint: "Pick one.",
          },
        },
      },
    });
    render(<TenantPage nav={null} tenantId={9} />);
    await waitFor(() => expect(screen.getByText("There is no tenant 9")).toBeTruthy());
  });
});
