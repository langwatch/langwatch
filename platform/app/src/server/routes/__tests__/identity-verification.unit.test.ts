/**
 * @vitest-environment node
 *
 * The GET-renders/POST-completes route shape of the email verification
 * ceremony (D01): a fetched magic link must never verify anything — only the
 * POST carrying the token AND the initiating context's PKCE verifier can.
 *
 * See specs/identity/identifier-model.feature.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VerifyIdentifierCommandData } from "~/server/event-sourcing/pipelines/identity/schemas/commands";
import { getServerAuthSession } from "~/server/auth";
import {
  type IdentityVerificationRecord,
  type IdentityVerificationStore,
  s256Challenge,
  VerificationCeremonyService,
} from "~/server/app-layer/identity/verification-ceremony";
import { app, setVerificationCeremoniesForTests } from "../identity-verification";

vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn(async () => null),
}));

const USER = "user_sam";
const IDENTIFIER = "idf_work";

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

function magicLinkPath(minted: { verificationId: string; token: string }) {
  return `/api/identity/verify?vid=${encodeURIComponent(minted.verificationId)}&token=${encodeURIComponent(minted.token)}`;
}

describe("the verification route shape", () => {
  describe("when the emailed magic link is opened with a GET request", () => {
    /** @scenario "Email verification completes only with the ceremony's proof" */
    it("renders only; completion needs the POST with token and verifier", async () => {
      const codeVerifier = "held-by-the-initiating-context";
      const minted = await mint(codeVerifier);

      const rendered = await app.request(magicLinkPath(minted));
      expect(rendered.status).toBe(200);
      expect(verifyIdentifier).not.toHaveBeenCalled();
      expect(store.records.has(IDENTIFIER)).toBe(true);

      vi.mocked(getServerAuthSession).mockResolvedValue({
        user: { id: USER },
      } as never);
      const completed = await app.request("/api/identity/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          identifierId: IDENTIFIER,
          verificationId: minted.verificationId,
          token: minted.token,
          codeVerifier,
        }),
      });
      expect(completed.status).toBe(200);
      expect(await completed.json()).toEqual({ verified: true });
      expect(verifyIdentifier).toHaveBeenCalledTimes(1);
    });
  });

  describe("when a link-scanning gateway prefetches the magic link", () => {
    /** @scenario "A mail scanner's prefetch cannot verify an identifier" */
    it("leaves the identifier unverified and the token unconsumed", async () => {
      const minted = await mint("verifier-the-scanner-never-had");

      // Scanners follow GET and some retry; none of it may consume anything.
      for (let fetchCount = 0; fetchCount < 3; fetchCount += 1) {
        const response = await app.request(magicLinkPath(minted));
        expect(response.status).toBe(200);
      }

      expect(verifyIdentifier).not.toHaveBeenCalled();
      expect(store.records.get(IDENTIFIER)?.verificationId).toBe(
        minted.verificationId,
      );
    });
  });

  describe("when completion is posted without a session", () => {
    it("answers 401 before touching the ceremony", async () => {
      const minted = await mint("verifier");
      const response = await app.request("/api/identity/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          identifierId: IDENTIFIER,
          verificationId: minted.verificationId,
          token: minted.token,
          codeVerifier: "verifier",
        }),
      });
      expect(response.status).toBe(401);
      expect(verifyIdentifier).not.toHaveBeenCalled();
    });
  });
});
