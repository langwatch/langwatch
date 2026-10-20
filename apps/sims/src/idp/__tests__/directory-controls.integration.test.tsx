// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TenantPage } from "../tenant-page.tsx";
import { fakeSimulator, tenantOne } from "./fake-simulator.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const [admin] = tenantOne.users;
if (!admin) throw new Error("the fixture tenant has no users");
const connected = {
  ...tenantOne,
  provisioning: { configured: true, baseUrl: "https://app.example/api/scim/v2", token: "••" },
};

const type = ({ name, value }: { name: string; value: string }) =>
  fireEvent.change(screen.getByLabelText(name), { target: { value } });

describe("a tenant's directory and provider controls", () => {
  /** @scenario "The console adds a person to a tenant's directory" */
  it("adds a person and reads the directory again", async () => {
    const { sent } = fakeSimulator({
      routes: {
        "GET /api/t/1": { body: tenantOne },
        "POST /control/t/1/users": {
          status: 201,
          body: { ...admin, id: "t1-user-x", email: "new@acme1.test", userName: "new@acme1.test" },
        },
      },
    });
    window.history.replaceState(null, "", "/t/1/#users");
    render(<TenantPage tenantId={1} />);
    await screen.findByText("Add a person");

    type({ name: "Email", value: "new@acme1.test" });
    type({ name: "Given name", value: "Nia" });
    type({ name: "Groups", value: "Everyone, Admins" });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await vi.waitFor(() =>
      expect(sent.filter((request) => request.path === "/api/t/1").length).toBe(2),
    );
    expect(sent.find((request) => request.method === "POST")?.body).toEqual({
      email: "new@acme1.test",
      givenName: "Nia",
      familyName: "",
      groups: ["Everyone", "Admins"],
    });
  });

  /** @scenario "The console disables and re-enables a person at the IdP" */
  it("disables a person, and shows the simulator's plain-text refusal", async () => {
    const { sent } = fakeSimulator({
      routes: {
        "GET /api/t/1": { body: tenantOne },
        "POST /control/t/1/user-active": { status: 404, body: "no user admin@acme1.test" },
      },
    });
    window.history.replaceState(null, "", "/t/1/#users");
    render(<TenantPage tenantId={1} />);
    const row = (await screen.findByText(admin.email)).closest("tr");
    if (row === null) throw new Error("no row for the admin");
    fireEvent.click(within(row).getByRole("button", { name: "Disable" }));

    expect(await screen.findByText(/no user admin@acme1\.test/u)).toBeTruthy();
    expect(sent.find((request) => request.method === "POST")?.body).toEqual({
      user: admin.email,
      active: false,
    });
  });

  /** @scenario "The console sends one SCIM event on demand" */
  it("sends the chosen SCIM event and shows LangWatch's answer", async () => {
    const { sent } = fakeSimulator({
      routes: {
        "GET /api/t/1": { body: connected },
        "POST /control/t/1/scim-event": { body: { event: { response: { status: 204 } } } },
      },
    });
    window.history.replaceState(null, "", "/t/1/#provisioning");
    render(<TenantPage tenantId={1} />);
    await screen.findByText("Send one SCIM event");

    type({ name: "Event", value: "user.deactivate" });
    type({ name: "PATCH style", value: "entra" });
    type({ name: "Person", value: admin.email });
    fireEvent.click(screen.getByRole("button", { name: "Send event" }));

    expect(await screen.findByText("LangWatch answered 204")).toBeTruthy();
    expect(sent.find((request) => request.method === "POST")?.body).toEqual({
      kind: "user.deactivate",
      style: "entra",
      user: admin.email,
      group: "",
    });
  });

  /** @scenario "The console sends an Auth0 SCIM webhook" */
  it("sends an Auth0 webhook and shows the stack's answer", async () => {
    const { sent } = fakeSimulator({
      routes: {
        "GET /api/t/1": { body: tenantOne },
        "POST /control/t/1/auth0-webhook": {
          body: { status: 200, event: "deactivate", user: admin.email },
        },
      },
    });
    window.history.replaceState(null, "", "/t/1/#provisioning");
    render(<TenantPage tenantId={1} />);
    await screen.findByText("Send an Auth0 SCIM webhook");

    type({ name: "Webhook event", value: "deactivate" });
    type({ name: "Webhook person", value: admin.email });
    type({ name: "Stack address", value: "https://app.example" });
    type({ name: "Webhook secret", value: "whsec" });
    fireEvent.click(screen.getByRole("button", { name: "Send webhook" }));

    expect(await screen.findByText("The stack answered 200")).toBeTruthy();
    expect(sent.find((request) => request.method === "POST")?.body).toEqual({
      event: "deactivate",
      user: admin.email,
      target: "https://app.example",
      secret: "whsec",
      token: "",
    });
  });

  /** @scenario "The console makes a tenant pose as a legacy provider and shows its env lines" */
  it("poses as Okta and shows the issuer and env lines", async () => {
    const { sent } = fakeSimulator({
      routes: {
        "GET /api/t/1": { body: tenantOne },
        "POST /control/t/1/legacy-provider": {
          body: {
            provider: "okta",
            issuer: "http://idp.test/t/1/oauth2/default",
            discovery: "http://idp.test/t/1/oauth2/default/.well-known/openid-configuration",
          },
        },
        "GET /control/t/1/legacy-env": { body: "OKTA_CLIENT_ID=langwatch-legacy-okta\n" },
      },
    });
    window.history.replaceState(null, "", "/t/1/#setup");
    render(<TenantPage tenantId={1} />);
    await screen.findByText("Pose as a legacy provider");

    fireEvent.click(screen.getByRole("button", { name: "Pose as this provider" }));

    expect(await screen.findByText(/OKTA_CLIENT_ID=langwatch-legacy-okta/u)).toBeTruthy();
    expect(screen.getByText("http://idp.test/t/1/oauth2/default")).toBeTruthy();
    expect(sent.find((request) => request.method === "POST")?.body).toEqual({ provider: "okta" });
  });
});
