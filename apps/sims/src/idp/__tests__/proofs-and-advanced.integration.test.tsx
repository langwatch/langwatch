// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TenantPage } from "../tenant-page.tsx";
import { fakeSimulator, tenantOne } from "./fake-simulator.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const type = ({ name, value }: { name: string; value: string }) =>
  fireEvent.change(screen.getByLabelText(name), { target: { value } });

const connected = {
  ...tenantOne,
  provisioning: { configured: true, baseUrl: "https://app.example/api/scim/v2", token: "••" },
};

describe("proofs on any domain", () => {
  /** @scenario "The console publishes and removes a TXT record on any domain" */
  it("publishes TXT values at a name, then removes the record", async () => {
    const { sent } = fakeSimulator({
      routes: {
        "GET /api/t/1": { body: tenantOne },
        "PUT /control/dns/txt": { body: { domain: "_x.other.test", values: ["a", "b"] } },
        "DELETE /control/dns/txt": { body: {} },
      },
    });
    window.history.replaceState(null, "", "/t/1/#domain");
    render(<TenantPage tenantId={1} />);
    await screen.findByText("A TXT record on any domain");

    type({ name: "TXT domain", value: "_x.other.test" });
    type({ name: "TXT values", value: "a\n\n b \n" });
    fireEvent.click(screen.getByRole("button", { name: "Publish TXT" }));
    expect(await screen.findByText("Published at _x.other.test.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove TXT" }));
    expect(await screen.findByText("Removed the TXT record at _x.other.test.")).toBeTruthy();

    const txt = sent.filter((request) => request.path === "/control/dns/txt");
    expect(txt).toEqual([
      {
        method: "PUT",
        path: "/control/dns/txt",
        body: { domain: "_x.other.test", values: ["a", "b"] },
      },
      { method: "DELETE", path: "/control/dns/txt", body: { domain: "_x.other.test" } },
    ]);
  });

  /** @scenario "The console serves and stops the well-known verification file for a domain" */
  it("serves a token as the verification file, then stops", async () => {
    const { sent } = fakeSimulator({
      routes: {
        "GET /api/t/1": { body: tenantOne },
        "PUT /control/verification": { body: { domain: "other.test", token: "tok-1" } },
        "DELETE /control/verification": { body: {} },
      },
    });
    window.history.replaceState(null, "", "/t/1/#domain");
    render(<TenantPage tenantId={1} />);
    await screen.findByText("Well-known verification file");

    type({ name: "File domain", value: "other.test" });
    type({ name: "Token", value: "tok-1" });
    fireEvent.click(screen.getByRole("button", { name: "Serve the file" }));
    expect(await screen.findByText("Serving the file for other.test.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop serving" }));
    expect(await screen.findByText("Stopped serving the file for other.test.")).toBeTruthy();

    const file = sent.filter((request) => request.path === "/control/verification");
    expect(file.map((request) => [request.method, request.body])).toEqual([
      ["PUT", { domain: "other.test", token: "tok-1" }],
      ["DELETE", { domain: "other.test" }],
    ]);
  });
});

describe("advanced SCIM events and signing inputs", () => {
  /** @scenario "The console sends a SCIM event with ids, attributes and the enterprise extension" */
  it("sends the advanced fields and refuses a malformed attribute line", async () => {
    const { sent } = fakeSimulator({
      routes: {
        "GET /api/t/1": { body: connected },
        "POST /control/t/1/scim-event": { body: { event: { response: { status: 201 } } } },
      },
    });
    window.history.replaceState(null, "", "/t/1/#provisioning");
    render(<TenantPage tenantId={1} />);
    await screen.findByText("Send one SCIM event");

    type({ name: "Event", value: "user.create" });
    type({ name: "Set attributes", value: "not a pair" });
    fireEvent.click(screen.getByRole("button", { name: "Send event" }));
    expect(await screen.findByText('"not a pair" is not key=value')).toBeTruthy();
    expect(sent.some((request) => request.method === "POST")).toBe(false);

    type({ name: "Their id", value: "lw-42" });
    type({ name: "Set attributes", value: "givenName=Ada\nactive=false" });
    fireEvent.click(screen.getByLabelText("Create inactive"));
    fireEvent.click(screen.getByLabelText("Leave out externalId"));
    type({ name: "Department", value: "Research" });
    fireEvent.click(screen.getByRole("button", { name: "Send event" }));

    expect(await screen.findByText("LangWatch answered 201")).toBeTruthy();
    expect(sent.find((request) => request.method === "POST")?.body).toEqual({
      kind: "user.create",
      style: "okta",
      user: "",
      group: "",
      id: "lw-42",
      set: { givenName: "Ada", active: false },
      inactive: true,
      noExternalId: true,
      enterprise: { department: "Research" },
    });
  });

  /** @scenario "The signing inputs follow the tenant after a reset" */
  it("re-seeds the skew input and break select when the tenant is read again", async () => {
    fakeSimulator({
      routes: {
        "GET /api/t/1": {
          body: { ...tenantOne, signing: { keys: ["t1-k1"], skewSeconds: 0, armed: "" } },
        },
        "POST /control/t/1/reset": { body: {} },
      },
    });
    window.history.replaceState(null, "", "/t/1/#signing");
    render(<TenantPage tenantId={1} />);
    const skew = await screen.findByRole("spinbutton", { name: "Skew in seconds" });
    const brk = screen.getByRole("combobox", { name: "Break" });
    fireEvent.change(skew, { target: { value: "600" } });
    fireEvent.change(brk, { target: { value: "saml-expired" } });

    const reset = screen.getByRole("button", { name: "Reset tenant" });
    fireEvent.click(reset);
    fireEvent.click(reset);

    await waitFor(() =>
      expect(screen.getByRole("spinbutton", { name: "Skew in seconds" })).toHaveProperty(
        "value",
        "0",
      ),
    );
    expect(screen.getByRole("combobox", { name: "Break" })).toHaveProperty("value", "none");
  });
});
