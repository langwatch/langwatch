/**
 * @vitest-environment node
 *
 * The completion half of the email verification ceremony (D01): only the
 * `verification.complete` RPC carrying the token AND the initiating
 * context's PKCE verifier can verify anything. The magic link itself lands
 * on the app page /auth/verify-email, which renders and makes no request
 * (src/pages/auth/__tests__/verify-email.integration.test.tsx).
 *
 * See specs/identity/identifier-model.feature.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type IdentityVerificationRecord,
  type IdentityVerificationStore,
  s256Challenge,
  VerificationCeremonyService,
} from "~/server/app-layer/identity/verification-ceremony";
import { getServerAuthSession } from "~/server/auth";
import type { VerifyIdentifierCommandData } from "~/server/event-sourcing/pipelines/identity/schemas/commands";
import {
  app as identityFamilyApp,
  setVerificationCeremoniesForTests,
} from "../[[...route]]/app";

vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn(async () => null),
}));

const USER = "user_sam";
const IDENTIFIER = "idf_work";
const COMPLETE_PATH = "/api/identity/verification.complete";

class InMemoryVerificationStore implements IdentityVerificationStore {
  records = new Map<string, IdentityVerificationRecord>();

  async replaceForIdentifier(record: IdentityVerificationRecord) {
    this.records.set(record.identifierId, record);
  }

  async findByIdentifierId({ identifierId }: { identifierId: string }) {
    return this.records.get(identifierId) ?? null;
  }

  async consume({
    identifierId,
    verificationId,
  }: {
    identifierId: string;
    verificationId: string;
  }) {
    const record = this.records.get(identifierId);
    if (!record || record.verificationId !== verificationId) return false;
    this.records.delete(identifierId);
    return true;
  }
}

let store: InMemoryVerificationStore;
let service: VerificationCeremonyService;
let verifyIdentifier: ReturnType<typeof vi.fn>;

beforeEach(() => {
  store = new InMemoryVerificationStore();
  verifyIdentifier = vi.fn(async (_data: VerifyIdentifierCommandData) => []);
  service = new VerificationCeremonyService({
    store,
    identifiers: {
      findIdentifier: async () => ({ provider: "email", state: "ATTACHED" }),
    },
    ceremonies: { verifyIdentifier: verifyIdentifier as never },
    isLatched: async () => true,
  });
  setVerificationCeremoniesForTests(service);
});

afterEach(() => {
  setVerificationCeremoniesForTests(null);
  vi.mocked(getServerAuthSession).mockReset();
  vi.mocked(getServerAuthSession).mockResolvedValue(null as never);
});

async function mint(codeVerifier: string) {
  return service.mintEmailVerification({
    userId: USER,
    identifierId: IDENTIFIER,
    codeChallenge: s256Challenge(codeVerifier),
  });
}

function completionRequest(body: Record<string, string>) {
  return identityFamilyApp.request(COMPLETE_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("the verification completion RPC", () => {
  describe("when completion presents the token and the initiating context's verifier", () => {
    /** @scenario "Email verification completes only with the ceremony's proof" */
    it("verifies exactly once, and minting alone verified nothing", async () => {
      const codeVerifier = "held-by-the-initiating-context";
      const minted = await mint(codeVerifier);
      expect(verifyIdentifier).not.toHaveBeenCalled();
      expect(store.records.has(IDENTIFIER)).toBe(true);

      vi.mocked(getServerAuthSession).mockResolvedValue({
        user: { id: USER },
      } as never);
      const completed = await completionRequest({
        identifierId: IDENTIFIER,
        verificationId: minted.verificationId,
        token: minted.token,
        codeVerifier,
      });
      expect(completed.status).toBe(200);
      expect(await completed.json()).toEqual({ verified: true });
      expect(verifyIdentifier).toHaveBeenCalledTimes(1);
    });
  });

  describe("when completion is posted without a session", () => {
    it("answers 401 before touching the ceremony", async () => {
      const minted = await mint("verifier");
      const response = await completionRequest({
        identifierId: IDENTIFIER,
        verificationId: minted.verificationId,
        token: minted.token,
        codeVerifier: "verifier",
      });
      expect(response.status).toBe(401);
      expect(verifyIdentifier).not.toHaveBeenCalled();
    });
  });

  describe("when completion presents a refusable proof", () => {
    it("answers the handled code, never a generic failure", async () => {
      const minted = await mint("the-real-verifier");
      vi.mocked(getServerAuthSession).mockResolvedValue({
        user: { id: USER },
      } as never);
      const response = await completionRequest({
        identifierId: IDENTIFIER,
        verificationId: minted.verificationId,
        token: minted.token,
        codeVerifier: "a-wrong-verifier",
      });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error?: { code?: string } } & {
        code?: string;
      };
      expect(body.error?.code ?? body.code).toBe(
        "identity_verification_invalid",
      );
      expect(verifyIdentifier).not.toHaveBeenCalled();
    });
  });
});
