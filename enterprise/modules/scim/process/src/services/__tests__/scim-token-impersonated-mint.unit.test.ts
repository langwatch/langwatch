// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * No SCIM token is minted while an operator acts as another member (F05).
 *
 * @see enterprise/modules/scim/specs/scim.feature
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import { describe, expect, it, vi } from "vitest";

import { ScimTokenMintService } from "../scim-token-mint.service.ts";

describe("ScimTokenMintService.assertMayMint", () => {
  /** @scenario No SCIM token is minted while an operator acts as another member */
  it("No SCIM token is minted while an operator acts as another member", async () => {
    const findPermissionsBeyondCaller = vi.fn<AuthzApi["findPermissionsBeyondCaller"]>(
      async () => [],
    );
    const minting = ScimTokenMintService.create({ findPermissionsBeyondCaller });

    await expect(
      minting.assertMayMint({
        organizationId: "organization-1",
        by: { id: "member-1", impersonatorId: "operator-1" },
      }),
    ).rejects.toMatchObject({ code: "permission_denied" });
    expect(findPermissionsBeyondCaller).not.toHaveBeenCalled();
  });
});
