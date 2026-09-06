/**
 * Unit coverage for the sandbox key the runs of one project share: what it asks for, whose
 * credential it is, when it is reused, and what a failed mint does to the run.
 * Spec: specs/agent-cache/agent-cache.feature
 */

import { AGENT_SANDBOX_API_KEY_NAME, type ApiKeyService } from "@langwatch/api-key-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentSandboxKeySharePort } from "../../ports/agent-sandbox-key-share.port";
import { AgentSandboxKeyMintService } from "../agent-sandbox-key-mint.service";

const create = vi.fn();

// The mint takes the composed capability now rather than building one from a
// Prisma client, so the double is the capability itself and no module needs
// spying on.
const apiKeys = { create } as unknown as ApiKeyService;

/** The share as a process holds it: whatever was last held, for as long as the test runs. */
class MemoryShare extends AgentSandboxKeySharePort {
  private held?: string;

  constructor(private readonly readable = true) {
    super();
  }

  async tryGet(): Promise<string | undefined> {
    // An unreadable share is one whose sealed entry no longer opens: the
    // instance's secret rotated, or the entry was altered.
    return this.readable ? this.held : undefined;
  }

  async hold(input: { token: string }): Promise<void> {
    this.held = input.token;
  }
}

/** Nobody owns a shared project; a personal workspace answers its owner. */
function repositoryOwning(ownerUserId: string | null) {
  const tryFindPersonalWorkspaceOwner = vi
    .fn()
    .mockResolvedValue(ownerUserId === null ? null : { ownerUserId });
  return { repository: { tryFindPersonalWorkspaceOwner }, tryFindPersonalWorkspaceOwner };
}

function mintService(options: { ownerUserId?: string | null; share?: AgentSandboxKeySharePort }) {
  const { repository, tryFindPersonalWorkspaceOwner } = repositoryOwning(
    options.ownerUserId ?? null,
  );
  return {
    service: AgentSandboxKeyMintService.create({
      apiKeys,
      repository,
      share: options.share ?? new MemoryShare(),
    }),
    tryFindPersonalWorkspaceOwner,
  };
}

describe("the agent sandbox key", () => {
  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue({
      token: "sk-lw-minted",
      apiKey: { id: "key_1" },
    });
  });

  describe("given a project in a shared team", () => {
    describe("when a run asks for a key", () => {
      /** @scenario "A run in a shared project gets a key no user holds" */
      it("asks for the manage grain and nothing else, owned by no user", async () => {
        await mintService({}).service.mint({
          projectId: "project_1",
          organizationId: "organization_1",
        });

        expect(create).toHaveBeenCalledTimes(1);
        expect(create.mock.calls[0]?.[0]).toMatchObject({
          name: AGENT_SANDBOX_API_KEY_NAME,
          isSystemManaged: true,
          userId: null,
          createdByUserId: null,
          permissionMode: "restricted",
          // Written out rather than read from the constant the code itself
          // passes: a grain added to that list has to fail here, which is the
          // whole reason this assertion exists.
          permissions: ["agentCache:manage"],
          bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: "project_1" }],
        });
      });

      it("binds the key to a lifetime", async () => {
        await mintService({}).service.mint({
          projectId: "project_1",
          organizationId: "organization_1",
        });

        const createCall = create.mock.calls[0];
        if (!createCall) throw new Error("create was never called");
        const { expiresAt } = createCall[0] as { expiresAt: Date };
        expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
      });
    });
  });

  describe("given a project in a personal workspace", () => {
    describe("when a run of that project mints its key", () => {
      /**
       * A personal workspace admits no principal but its owner, so a key owned
       * by nobody is refused there. The one credential it accepts is the
       * owner's own, and the owner's ceiling then caps the key.
       */
      it("mints the key as the workspace owner's own", async () => {
        const { service, tryFindPersonalWorkspaceOwner } = mintService({ ownerUserId: "owner_1" });

        await service.mint({ projectId: "project_1", organizationId: "organization_1" });

        expect(tryFindPersonalWorkspaceOwner).toHaveBeenCalledWith({
          organizationId: "organization_1",
          scopeId: "project_1",
        });
        expect(create.mock.calls[0]?.[0]).toMatchObject({
          userId: "owner_1",
          createdByUserId: "owner_1",
        });
      });
    });
  });

  describe("given a run of this project already got a key", () => {
    describe("when a later run of the same project asks for one", () => {
      it("hands out the held token without minting a second key", async () => {
        const { service } = mintService({});

        const first = await service.getOrMint({
          projectId: "project_1",
          organizationId: "organization_1",
        });
        const second = await service.getOrMint({
          projectId: "project_1",
          organizationId: "organization_1",
        });

        expect(second).toBe(first);
        expect(create).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given the held token cannot be read", () => {
    describe("when a run asks for a key", () => {
      /** @scenario "A shared key the platform can no longer read is replaced" */
      it("mints a new key and shares that one from then on", async () => {
        const { service } = mintService({ share: new MemoryShare(false) });
        create.mockResolvedValueOnce({ token: "sk-lw-first", apiKey: { id: "key_1" } });
        create.mockResolvedValueOnce({ token: "sk-lw-second", apiKey: { id: "key_2" } });

        const replacement = await service.getOrMint({
          projectId: "project_1",
          organizationId: "organization_1",
        });

        expect(replacement).toBe("sk-lw-first");
        expect(create).toHaveBeenCalledTimes(1);

        // An unreadable share never answers, so the next run mints again
        // rather than being handed something it cannot use.
        expect(
          await service.getOrMint({
            projectId: "project_1",
            organizationId: "organization_1",
          }),
        ).toBe("sk-lw-second");
      });
    });
  });

  describe("given a platform that holds no shared key and cannot mint one", () => {
    describe("when a run asks for one", () => {
      /** @scenario "A run whose key could not be minted still runs" */
      it("answers with no key rather than raising", async () => {
        create.mockRejectedValue(new Error("the ledger is unreachable"));

        await expect(
          mintService({}).service.tryGetOrMint({
            projectId: "project_1",
            organizationId: "organization_1",
          }),
        ).resolves.toBeUndefined();
      });
    });
  });
});
