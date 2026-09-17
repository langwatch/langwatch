/**
 * @vitest-environment node
 * @see specs/features/agents/voice-phone.feature
 * `findTwilioProviderForProject` resolves the enabled Twilio provider a key
 * needs; `findTwilioCredential` reads its three keys. Repository/Prisma mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const findAllAccessibleForProject = vi.fn();
const findUnique = vi.fn();
const readCustomKeys = vi.fn();
import { TwilioCredentialService } from "../services/twilio-credential.service.ts";

const service = TwilioCredentialService.create({
  providers: {
    findById: (id) => findUnique(id),
    listAccessible: (projectId) => findAllAccessibleForProject(projectId),
  },
  credentials: { readCustomKeys: (value) => readCustomKeys(value) },
});

beforeEach(() => vi.clearAllMocks());

describe("findTwilioProviderForProject", () => {
  describe("when the project has an enabled Twilio row", () => {
    it("returns that row's id", async () => {
      findAllAccessibleForProject.mockResolvedValue([
        { id: "prov_openai", provider: "openai", enabled: true },
        { id: "prov_twilio", provider: "twilio", enabled: true },
      ]);
      const result = await service.findProviderForProject({ projectId: "p1" });
      expect(result).toEqual({ id: "prov_twilio" });
    });
  });

  describe("when no enabled Twilio row is accessible", () => {
    it("returns null for a disabled or non-Twilio project", async () => {
      findAllAccessibleForProject.mockResolvedValue([
        { id: "prov_twilio_off", provider: "twilio", enabled: false },
        { id: "prov_openai", provider: "openai", enabled: true },
      ]);
      const result = await service.findProviderForProject({ projectId: "p1" });
      expect(result).toBeNull();
    });
  });
});

describe("findTwilioCredential", () => {
  describe("when the row is a Twilio row with all three keys", () => {
    it("returns the account SID, auth token and from-number", async () => {
      findUnique.mockResolvedValue({
        provider: "twilio",
        customKeys: "cipher",
      });
      readCustomKeys.mockReturnValue({
        state: "read",
        keys: {
          TWILIO_ACCOUNT_SID: "AC123",
          TWILIO_AUTH_TOKEN: "tok-secret",
          TWILIO_FROM_NUMBER: "+14155550000",
        },
      });
      const result = await service.findCredential({ modelProviderId: "prov_1" });
      expect(result).toEqual({
        accountSid: "AC123",
        authToken: "tok-secret",
        fromNumber: "+14155550000",
      });
    });
  });

  describe("when a required key is missing", () => {
    it("returns null rather than a half-formed credential", async () => {
      findUnique.mockResolvedValue({
        provider: "twilio",
        customKeys: "cipher",
      });
      readCustomKeys.mockReturnValue({
        state: "read",
        keys: { TWILIO_ACCOUNT_SID: "AC123", TWILIO_AUTH_TOKEN: "tok-secret" },
      });
      const result = await service.findCredential({ modelProviderId: "prov_1" });
      expect(result).toBeNull();
    });
  });

  describe("when the row is not a Twilio row", () => {
    it("returns null without reading any key", async () => {
      findUnique.mockResolvedValue({
        provider: "openai",
        customKeys: "cipher",
      });
      const result = await service.findCredential({ modelProviderId: "prov_1" });
      expect(result).toBeNull();
      expect(readCustomKeys).not.toHaveBeenCalled();
    });
  });
});
