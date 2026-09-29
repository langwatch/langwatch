// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Landing } from "../landing.tsx";
import { fakeSimulator } from "./fake-simulator.ts";

const index = {
  baseUrl: "http://idp.test",
  dnsAddr: "127.0.0.1:15353",
  tenants: [
    { id: 1, domain: "acme1.test", baseUrl: "http://idp.test/t/1", users: 2, applications: 0 },
    { id: 2, domain: "acme2.test", baseUrl: "http://idp.test/t/2", users: 2, applications: 1 },
    { id: 3, domain: "acme3.test", baseUrl: "http://idp.test/t/3", users: 2, applications: 0 },
  ],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the landing page", () => {
  /** @scenario "The landing page says what to do before it lists the providers" */
  it("names the three steps before the providers, with the base address copyable and the control API folded", async () => {
    fakeSimulator({ routes: { "GET /api/tenants": { body: index } } });
    render(<Landing nav={null} />);
    await screen.findByText("acme1.test");

    const text = document.body.textContent ?? "";
    const steps = ["Pick a provider", "Register your application", "Sign in from LangWatch"];
    const positions = steps.map((step) => text.indexOf(step));
    expect(positions).toEqual(positions.toSorted((a, b) => a - b));
    expect(positions[2]).toBeLessThan(text.indexOf("acme1.test"));

    expect(screen.getByText("http://idp.test")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy base address" })).toBeTruthy();

    expect(screen.queryByText("Puts one tenant back the way it started")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show requests" }));
    expect(screen.getByText("Puts one tenant back the way it started")).toBeTruthy();
  });

  /** @scenario "A provider that already has an application registered is marked as such" */
  it("marks only the provider that already has an application", async () => {
    fakeSimulator({ routes: { "GET /api/tenants": { body: index } } });
    render(<Landing nav={null} />);
    await screen.findByText("acme2.test");

    expect(screen.getAllByText("1 registered")).toHaveLength(1);
    const row = screen.getByText("acme2.test").closest("tr");
    expect(row === null ? null : within(row).getByText("1 registered")).toBeTruthy();
  });

  it("filters the providers by number or domain", async () => {
    fakeSimulator({ routes: { "GET /api/tenants": { body: index } } });
    render(<Landing nav={null} />);
    await screen.findByText("acme1.test");
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a provider" }), {
      target: { value: "acme3" },
    });
    expect(screen.queryByText("acme1.test")).toBeNull();
    expect(screen.getByText("1 providers")).toBeTruthy();
  });
});
