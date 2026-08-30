/**
 * @vitest-environment node
 *
 * The egress allow-list door, through the composition production uses.
 *
 * `LangyService` carries two heads: an older repository-backed set of methods
 * and a newer one over the composed feature services. `createComposed` — the
 * only construction outside tests — passes `null` for the repositories, so
 * every method still reading `this.persistence` throws "Langy persistence is
 * not configured".
 *
 * Both egress methods were in that half, and unlike the rest of it they are
 * reached: `LangyApp.egressAllowlist` calls them, and the `langyEgress` tRPC
 * router calls that. The first customer to open the egress settings would have
 * got a generic unknown error. These cases drive the composed path, so a
 * regression puts the throw back.
 */
import { describe, expect, it, vi } from "vitest";
import type { LangyConversationService } from "../langy-conversation.service";
import { LangyCredentialService } from "../langy-credential.service";
import type { LangyMessageService } from "../langy-message.service";
import type { LangyTurnService } from "../langy-turn.service";
import { LangyService } from "../langy.service";

/** Only the one collaborator the egress verbs reach. */
function credentialService(stored: string[] | null) {
  const saveEgressAllowlist = vi.fn(async () => undefined);
  const repository = {
    tryFindEgressAllowlist: vi.fn(async () => stored),
    saveEgressAllowlist,
  };
  const service = LangyCredentialService.create({
    repository: repository as never,
    sessionKeys: {} as never,
    virtualKeys: {} as never,
    github: {} as never,
    runtime: {} as never,
  });
  return { service, repository, saveEgressAllowlist };
}

function composed(credentials: LangyCredentialService) {
  return LangyService.createComposed(
    {} as unknown as LangyConversationService,
    {} as unknown as LangyTurnService,
    {} as unknown as LangyMessageService,
    credentials,
    { shouldPrompt: () => false } as never,
  );
}

describe("LangyService egress allow-list, composed the way production composes it", () => {
  describe("when an allow-list is stored", () => {
    it("reads it back rather than throwing on the absent repositories", async () => {
      const { service } = credentialService(["api.example.com"]);

      await expect(
        composed(service).tryGetEgressAllowlist({ projectId: "project-1" }),
      ).resolves.toEqual(["api.example.com"]);
    });
  });

  describe("when nothing is stored", () => {
    it("answers null, which the app reads as monitor-only", async () => {
      const { service } = credentialService(null);

      await expect(
        composed(service).tryGetEgressAllowlist({ projectId: "project-1" }),
      ).resolves.toBeNull();
    });
  });

  describe("when the allow-list is replaced", () => {
    it("normalises the hosts and saves them", async () => {
      const { service, saveEgressAllowlist } = credentialService(null);

      await expect(
        composed(service).trySetEgressAllowlist({
          projectId: "project-1",
          allowlist: ["API.Example.com.", " other.example.com "],
        }),
      ).resolves.toEqual(["api.example.com", "other.example.com"]);

      expect(saveEgressAllowlist).toHaveBeenCalledWith("project-1", [
        "api.example.com",
        "other.example.com",
      ]);
    });

    it("clears back to monitor-only when the list is empty", async () => {
      const { service, saveEgressAllowlist } = credentialService(["api.example.com"]);

      await expect(
        composed(service).trySetEgressAllowlist({ projectId: "project-1", allowlist: [] }),
      ).resolves.toBeNull();

      expect(saveEgressAllowlist).toHaveBeenCalledWith("project-1", null);
    });
  });
});
