// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SignIn } from "../sign-in.tsx";
import { fakeSimulator } from "./fake-simulator.ts";

const query = "response_type=code&client_id=c&redirect_uri=https%3A%2F%2Fapp.example%2Fcb";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the account picker", () => {
  /** @scenario "An authorize request without a login hint offers the tenant's users" */
  it("lists the tenant's people, each linking back into the same authorize request", async () => {
    const hinted = `/t/1/oauth/authorize?${query}&login_hint=t1-user-admin`;
    const { sent } = fakeSimulator({
      routes: {
        [`GET /api/t/1/sign-in?${query}`]: {
          body: {
            tenantId: 1,
            domain: "acme1.test",
            refusal: null,
            users: [
              { name: "Ada Admin", email: "admin@acme1.test", href: hinted },
              { name: "Mel Member", email: "member@acme1.test", href: `${hinted}-member` },
            ],
          },
        },
      },
    });
    render(<SignIn tenantId={1} query={query} />);

    const admin = await screen.findByRole("link", { name: /Ada Admin/u });
    expect(admin.getAttribute("href")).toBe(hinted);
    expect(screen.getByText("member@acme1.test")).toBeTruthy();
    expect(sent[0]?.path).toBe(`/api/t/1/sign-in?${query}`);
  });

  /** @scenario "A registered application may only be sent back to a registered address" */
  it("explains a refused request instead of offering anybody", async () => {
    fakeSimulator({
      routes: {
        [`GET /api/t/2/sign-in?${query}`]: {
          body: {
            tenantId: 2,
            domain: "acme2.test",
            refusal: {
              title: "That redirect address is not registered",
              detail:
                "The application LangWatch asked to be sent back to https://app.example/cb, which is not one of the addresses it registered.",
              hint: "Register that address on the tenant page.",
            },
            users: [],
          },
        },
      },
    });
    render(<SignIn tenantId={2} query={query} />);

    expect(await screen.findByText("That redirect address is not registered")).toBeTruthy();
    expect(
      screen.getByText(
        /The application LangWatch asked to be sent back to https:\/\/app\.example\/cb/u,
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("link", { name: /@acme2\.test/u })).toBeNull();
    expect(screen.getByRole("link", { name: "Open tenant 2" }).getAttribute("href")).toBe("/t/2/");
  });
});
