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
    expect(SCIM_SPEC_OPTIONS.documentation.components?.securitySchemes?.scim_bearer).toBeDefined();
    expect(GET_SERVICE_PROVIDER_CONFIG.security).toEqual([]);
    expect(JSON.stringify(GET_SERVICE_PROVIDER_CONFIG)).toContain("maxResults");
  });

  it("keeps Users and Groups list operations bearer-protected", () => {
    expect(LIST_USERS.security).toEqual([{ scim_bearer: [] }]);
    expect(LIST_GROUPS.security).toEqual([{ scim_bearer: [] }]);
  });
});
