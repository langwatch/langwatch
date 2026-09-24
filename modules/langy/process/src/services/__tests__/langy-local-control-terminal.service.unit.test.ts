/** The terminal's requests are read and decided for the key's owner only. */
import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzApi } from "@langwatch/authz-contract";
import { describe, expect, it, vi } from "vitest";

import type { ControlRequestService } from "../langy-local-control-request.service.ts";
import { LangyLocalControlTerminalService } from "../langy-local-control-terminal.service.ts";

function terminal() {
  const listOpen = vi.fn<ControlRequestService["listOpen"]>(async () => []);
  const service = LangyLocalControlTerminalService.create({
    requests: createApiFixture<ControlRequestService>({ listOpen }),
    permissions: createApiFixture<Pick<AuthzApi, "getDecision">>(),
    baseHost: "https://app.test",
  });
  return { listOpen, service };
}

describe("listing the terminal's open requests", () => {
  describe("given a key a person owns", () => {
    it("reads that person's requests", async () => {
      const { listOpen, service } = terminal();

      const listed = await service.listRequests({ actor: { type: "user", id: "user-1" } });

      expect(listed).toEqual({ requests: [] });
      expect(listOpen).toHaveBeenCalledWith({ userId: "user-1" });
    });
  });

  describe("given a key no person owns", () => {
    it("refuses as an invalid request without reading any", async () => {
      const { listOpen, service } = terminal();

      await expect(service.listRequests({ actor: null })).rejects.toMatchObject({
        code: "langy_local_request_invalid",
      });
      expect(listOpen).not.toHaveBeenCalled();
    });
  });
});

describe("approving a request", () => {
  describe("given a key no person owns", () => {
    it("refuses before any request is addressed", async () => {
      const { service } = terminal();

      await expect(
        service.approveRequest({ actor: null, requestId: "request-1" }),
      ).rejects.toMatchObject({ code: "langy_local_request_invalid" });
    });
  });
});
