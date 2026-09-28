import { describe, expect, it } from "vitest";

import { consoleLinks } from "../console-links.ts";
import { routeOf } from "../route.ts";

describe("routeOf", () => {
  it("reads the landing page, a tenant's page and the account picker off the address", () => {
    expect(routeOf({ pathname: "/", search: "" })).toEqual({ page: "landing" });
    expect(routeOf({ pathname: "/t/3", search: "" })).toEqual({ page: "tenant", tenantId: 3 });
    expect(routeOf({ pathname: "/t/3/", search: "" })).toEqual({ page: "tenant", tenantId: 3 });
    expect(routeOf({ pathname: "/t/2/oauth/authorize", search: "?client_id=c&state=s" })).toEqual({
      page: "sign-in",
      tenantId: 2,
      query: "client_id=c&state=s",
    });
  });

  it("answers not-found for anything else", () => {
    expect(routeOf({ pathname: "/t/x/", search: "" })).toEqual({ page: "not-found" });
    expect(routeOf({ pathname: "/nothing", search: "" })).toEqual({ page: "not-found" });
  });
});

describe("consoleLinks", () => {
  const at = ({ hostname, port = "1355" }: { hostname: string; port?: string }) => ({
    protocol: "https:",
    hostname,
    port,
  });

  it("links a worktree's simulator to its home, its mail and the hub", () => {
    const chrome = consoleLinks({
      location: at({ hostname: "idp.feature-one.langwatch.localhost" }),
    });
    expect(chrome.slug).toBe("feature-one");
    expect(chrome.homeHref).toBe("https://feature-one.langwatch.localhost:1355");
    expect(chrome.links.map((link) => link.label)).toEqual(["Home", "Identity", "Mail", "Hub"]);
  });

  it("links the machine-wide simulator to the hub only", () => {
    const chrome = consoleLinks({
      location: at({ hostname: "idp.langwatch.localhost", port: "" }),
    });
    expect(chrome.slug).toBeUndefined();
    expect(chrome.links).toEqual([
      { label: "Identity", href: "/", current: true },
      { label: "Hub", href: "https://hub.langwatch.localhost" },
    ]);
  });

  it("links nowhere on a bare port", () => {
    expect(consoleLinks({ location: at({ hostname: "127.0.0.1", port: "5565" }) }).links).toEqual(
      [],
    );
  });
});
