/**
 * No CLI login is approved while an operator acts as another member (F05).
 *
 * @see modules/auth/specs/cli-device-flow-refusals.feature
 */
import { PermissionDeniedError } from "@langwatch/authorization";
import { describe, expect, it, vi } from "vitest";

import {
  CliDeviceFlowService,
  type CliDeviceFlowCollaborators,
} from "../cli-device-flow.service.ts";

describe("CliDeviceFlowService.approveDeviceCode", () => {
  it("A CLI login is not approved while an operator acts as another member", async () => {
    const reached: PropertyKey[] = [];
    const session = async () => ({ id: "member-1", impersonator: { id: "operator-1" } });
    const collaborators = new Proxy<CliDeviceFlowCollaborators>(Object.create(null), {
      get: (_target, member) => {
        reached.push(member);
        return member === "session" ? session : vi.fn();
      },
    });
    const flow = CliDeviceFlowService.create({ collaborators });

    const refusal = flow.approveDeviceCode({
      raw: JSON.stringify({ user_code: "ABCD-EFGH", organization_id: "organization-1" }),
      headers: new Headers(),
    });

    await expect(refusal).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(reached).not.toContain("directory");
  });
});
