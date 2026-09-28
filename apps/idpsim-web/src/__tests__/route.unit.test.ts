import { describe, expect, it } from "vitest";

import { routeOf } from "../app.tsx";

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
