// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TenantPage } from "../tenant-page.tsx";
import { fakeSimulator, tenantOne } from "./fake-simulator.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const signed = { ...tenantOne, signing: { keys: ["t1-k2", "t1-k1"], skewSeconds: 0, armed: "" } };

describe("a tenant's signing tab", () => {
  /** @scenario "The console rotates a tenant's key, skews its clock and arms a broken response" */
  it("rotates the key, applies skew and arms a SAML break through the control API", async () => {
    const { sent } = fakeSimulator({
      routes: {
        "GET /api/t/1": { body: signed },
        "POST /control/t/1/rotate-key": {
          body: { current: "t1-k3", published: ["t1-k3", "t1-k2"] },
        },
        "POST /control/t/1/config": { body: { samlpSubjects: false, skewSeconds: 600 } },
        "POST /control/t/1/tamper": { body: { armed: "saml-expired" } },
      },
    });
    render(<TenantPage tenantId={1} />);
    fireEvent.click(await screen.findByText("Signing"));
    expect(await screen.findByText("t1-k2 (signs)")).toBeTruthy();
    expect(screen.getByText("t1-k1 (still published)")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Rotate the key" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Skew in seconds" }), {
      target: { value: "600" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply skew" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Break" }), {
      target: { value: "saml-expired" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Arm" }));

    await waitFor(() => expect(sent.filter((r) => r.method === "POST")).toHaveLength(3));
    const bodies = Object.fromEntries(sent.map((r) => [r.path, r.body]));
    expect(bodies["/control/t/1/rotate-key"]).toEqual({ dropPrevious: false });
    expect(bodies["/control/t/1/config"]).toEqual({ skewSeconds: 600 });
    expect(bodies["/control/t/1/tamper"]).toEqual({ mode: "saml-expired" });
  });

  /** @scenario "The console signs an IdP-initiated SAML response ready to post to the ACS" */
  it("signs an unsolicited response and offers a form that posts it to the ACS", async () => {
    fakeSimulator({
      routes: {
        "GET /api/t/1": { body: signed },
        "POST /control/t/1/saml/unsolicited": {
          body: { url: "https://app.example/acs", samlResponse: "PHNhbWw+", relayState: "/home" },
        },
      },
    });
    render(<TenantPage tenantId={1} />);
    fireEvent.click(await screen.findByText("Signing"));
    fireEvent.change(await screen.findByRole("textbox", { name: "ACS address" }), {
      target: { value: "https://app.example/acs" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign an unsolicited response" }));

    const post = await screen.findByRole("button", { name: "Post it to the ACS" });
    const form = post.closest("form");
    expect(form?.getAttribute("action")).toBe("https://app.example/acs");
    expect(form?.querySelector('input[name="SAMLResponse"]')?.getAttribute("value")).toBe(
      "PHNhbWw+",
    );
  });
});
