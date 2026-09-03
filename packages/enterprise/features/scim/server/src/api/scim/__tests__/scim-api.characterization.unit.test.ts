// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { describe, expect, it } from "vitest";
import {
  GET_SERVICE_PROVIDER_CONFIG,
  LIST_GROUPS,
  LIST_USERS,
  SCIM_SPEC_OPTIONS,
} from "../scim.api";

describe("SCIM transport characterization", () => {
  it("keeps discovery public and carries the documented page-size cap", () => {
    // `documentation` is optional on the spec options, so it is asserted
    // rather than assumed: without this the chain below reads as present when
    // the whole block could be absent, and the security scheme this test
    // exists to pin would vanish silently.
    expect(SCIM_SPEC_OPTIONS.documentation).toBeDefined();
    expect(SCIM_SPEC_OPTIONS.documentation?.components?.securitySchemes?.scim_bearer).toBeDefined();
    expect(GET_SERVICE_PROVIDER_CONFIG.security).toEqual([]);
    expect(JSON.stringify(GET_SERVICE_PROVIDER_CONFIG)).toContain("maxResults");
  });

  it("keeps Users and Groups list operations bearer-protected", () => {
    expect(LIST_USERS.security).toEqual([{ scim_bearer: [] }]);
    expect(LIST_GROUPS.security).toEqual([{ scim_bearer: [] }]);
  });
});
