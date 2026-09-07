import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../utils/apiKey", () => ({
  resolveCredentials: vi.fn(async () => ({
    apiKey: "test-key",
    source: "env",
    endpoint: "https://app.langwatch.ai",
  })),
}));

const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@/client-sdk/services/virtual-keys/virtual-keys-api.service", () => ({
  VirtualKeysApiService: class {
    create = create;
  },
}));

import { createVirtualKeyCommand } from "../create";

const SECRET = "vk-lw-01HZX9NABCDEFGHJKMNPQRSTVW";

const VIRTUAL_KEY = {
  id: "vk_1",
  name: "production-app",
  display_prefix: "vk-lw-01HZX9N",
  scopes: [{ scope_type: "PROJECT", scope_id: "proj_1" }],
  routing_mode: "NONE",
  routing_policy_id: null,
  principal_user_id: null,
};

const noop = () => {
  // suppresses output during tests
};

/** Everything the human form printed, joined. */
function printed(log: ReturnType<typeof vi.spyOn>): string {
  return log.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
}

describe("langwatch virtual-keys create", () => {
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    log = vi.spyOn(console, "log").mockImplementation(noop);
  });

  describe("when --reveal-once is passed", () => {
    /** @scenario "The CLI create with --reveal-once never prints the secret" */
    it("sends reveal_once and prints the id, the name, the prefix and the reveal id, never the secret", async () => {
      create.mockResolvedValue({
        virtual_key: VIRTUAL_KEY,
        reveal_id: "rvl_abc123",
        preview: "vk-lw-01HZX9N",
      });

      const result = await createVirtualKeyCommand({
        name: "production-app",
        revealOnce: true,
      });

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ name: "production-app", reveal_once: true }),
      );
      expect(result).toBeDefined();
      expect(result!.data).toEqual({
        virtual_key: VIRTUAL_KEY,
        reveal_id: "rvl_abc123",
        preview: "vk-lw-01HZX9N",
      });
      expect(JSON.stringify(result!.data)).not.toContain(SECRET);

      result!.table();
      const text = printed(log);
      expect(text).toContain("Virtual key id: vk_1");
      expect(text).toContain("Name:           production-app");
      expect(text).toContain("Prefix:         vk-lw-01HZX9N...");
      expect(text).toContain("Reveal id:      rvl_abc123");
      expect(text).toContain("The secret was not printed.");
      expect(text).not.toMatch(/vk-lw-[0-9A-Z]{26}/);
      expect(text).not.toContain("OPENAI_API_KEY");
    });
  });

  describe("when --reveal-once is not passed", () => {
    it("keeps printing the secret once, as before", async () => {
      create.mockResolvedValue({ virtual_key: VIRTUAL_KEY, secret: SECRET });

      const result = await createVirtualKeyCommand({ name: "production-app" });

      expect(create).toHaveBeenCalledWith(
        expect.not.objectContaining({ reveal_once: true }),
      );
      expect(result!.data).toEqual({ virtual_key: VIRTUAL_KEY, secret: SECRET });
      result!.table();
      expect(printed(log)).toContain(SECRET);
    });
  });
});
