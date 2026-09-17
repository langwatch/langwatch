/**
 * Which better-auth endpoint a sign-in dials, per kind of provider.
 *
 * An organization's own connection is registered with the `sso()` plugin and
 * is reached at `/sign-in/sso`, keyed on the connection id. The social and
 * generic-OAuth plugins share `/sign-in/social` and have never heard of a
 * connection id — they answer one with `404 PROVIDER_NOT_FOUND`.
 *
 * Every non-credential sign-in used to go to the social call, so the routed
 * sign-in this feature exists for — work address typed, handed to the
 * organization's provider — hit that 404, which the screen swallowed into a
 * spinner that never resolved. The setup page's test sign-in worked
 * throughout, because it calls `signIn.sso` itself.
 *
 * Specs: specs/identity/signin-router.feature,
 * specs/identity/sso-activation.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { ssoSpy, socialSpy, emailSpy } = vi.hoisted(() => ({
  ssoSpy: vi.fn(),
  socialSpy: vi.fn(),
  emailSpy: vi.fn(),
}));

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    useSession: () => ({ data: null, isPending: false, refetch: vi.fn() }),
    signIn: { email: emailSpy, social: socialSpy, sso: ssoSpy },
    signOut: vi.fn().mockResolvedValue({}),
    getSession: vi.fn().mockResolvedValue({ data: null }),
  }),
}));

const { signIn } = await import("../auth-client");

beforeEach(() => {
  vi.clearAllMocks();
  ssoSpy.mockResolvedValue({ error: null, data: {} });
  socialSpy.mockResolvedValue({ error: null, data: {} });
});

describe("given an organization's own single sign-on connection", () => {
  describe("when somebody is handed to it", () => {
    it("dials the sso plugin with the connection id, never the social one", async () => {
      await signIn("ssoc_2f8Qk3", { callbackUrl: "/", redirect: false });

      expect(ssoSpy).toHaveBeenCalledTimes(1);
      expect(ssoSpy.mock.calls[0]![0]).toMatchObject({
        providerId: "ssoc_2f8Qk3",
      });
      // The 404 this whole fix is about: the social plugin must never see a
      // connection id.
      expect(socialSpy).not.toHaveBeenCalled();
    });

    it("dials it under an environment-prefixed id too", async () => {
      // ksuids are minted with a deployment prefix, so the id a routed
      // sign-in carries is `local_ssoc_…` rather than a bare `ssoc_…`.
      await signIn("local_ssoc_2f8Qk3", { callbackUrl: "/", redirect: false });

      expect(ssoSpy).toHaveBeenCalledTimes(1);
      expect(socialSpy).not.toHaveBeenCalled();
    });

    it("hands back the refusal rather than resolving as a success", async () => {
      ssoSpy.mockResolvedValue({
        error: {
          message: "nope",
          code: "SSO_PROVIDER_NOT_ALLOWED",
          status: 403,
        },
      });

      const result = await signIn("ssoc_2f8Qk3", { redirect: false });

      expect(result).toMatchObject({
        ok: false,
        code: "SSO_PROVIDER_NOT_ALLOWED",
      });
    });
  });
});

describe("given a provider that is not a connection", () => {
  it("still dials the social plugin for a social provider", async () => {
    await signIn("google", { callbackUrl: "/", redirect: false });

    expect(socialSpy).toHaveBeenCalledTimes(1);
    expect(socialSpy.mock.calls[0]![0]).toMatchObject({ provider: "google" });
    expect(ssoSpy).not.toHaveBeenCalled();
  });

  it("keeps normalising azure-ad to microsoft on that path", async () => {
    await signIn("azure-ad", { callbackUrl: "/", redirect: false });

    expect(socialSpy.mock.calls[0]![0]).toMatchObject({
      provider: "microsoft",
    });
    expect(ssoSpy).not.toHaveBeenCalled();
  });
});
