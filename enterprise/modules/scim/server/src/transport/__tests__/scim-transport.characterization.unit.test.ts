// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 *
 * What the two published SCIM families declare about their doors and their
 * documentation. The security requirement is no longer written out per
 * operation: it follows the door each family declares, and `scimToken` is what
 * publishes `scim_bearer` — so this pins the door, which is what decides it.
 */
import { securityRequirement } from "@langwatch/api/access";
import { describe, expect, it } from "vitest";

import { LIST_GROUPS, LIST_USERS } from "../../rules/scim-openapi.rules.ts";
import { scimProtocolRest } from "../scim-protocol.rest.ts";
import { scimTokenRest } from "../scim-token.rest.ts";

const protocol = scimProtocolRest.router();
const tokens = scimTokenRest.router();

describe("SCIM transport characterization", () => {
  it("keeps discovery public and carries the documented page-size cap", () => {
    const discovery = protocol.routes.find(
      (route) => route.operation === "scimGetServiceProviderConfig",
    );

    expect(discovery?.access?.kind).toBe("public");
    expect(securityRequirement("public")).toEqual([]);
    expect(JSON.stringify(discovery?.docs)).toContain("maxResults");
  });

  it("keeps Users and Groups list operations bearer-protected", () => {
    expect(protocol.credential).toBe("scimToken");
    expect(securityRequirement("scimToken")).toEqual([{ scim_bearer: [] }]);

    const listUsers = protocol.routes.find((route) => route.operation === "scimListUsers");
    const listGroups = protocol.routes.find((route) => route.operation === "scimListGroups");

    expect(listUsers?.access?.kind).toBe("authenticated");
    expect(listGroups?.access?.kind).toBe("authenticated");
    expect(listUsers?.docs).toBe(LIST_USERS);
    expect(listGroups?.docs).toBe(LIST_GROUPS);
  });

  it("keeps the management family behind an organization credential and organization:manage", () => {
    expect(tokens.namespace).toBe("scim-tokens");
    expect(tokens.credential).toBe("organization");
    expect(tokens.routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      "get /",
      "post /",
      "delete /:id",
    ]);
    expect(tokens.routes.every((route) => route.permission === "organization:manage")).toBe(true);
  });
});
