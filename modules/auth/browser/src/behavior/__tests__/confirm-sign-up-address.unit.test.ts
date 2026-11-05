/**
 * The emailed sign-up link is single-use, so a screen that mounts twice must not spend it
 * twice. Spec: modules/auth/specs/invited-new-account.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { confirmSignUpAddress, forgetSignUpLinkSpends } from "../confirm-sign-up-address.ts";

const ANSWER = {
  email: "sam@acme.com",
  accountCreated: true,
  accountExists: false,
  addressProof: null,
  signedIn: true,
};

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  forgetSignUpLinkSpends();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("given a confirmation link being spent", () => {
  describe("when the screen asks to spend the same link again", () => {
    /** @scenario "A confirmation link is spent once per page, however often the screen mounts" */
    it("asks the server once and hands both askers the same answer", async () => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify(ANSWER), { status: 200 }));

      const whileInFlight = [
        confirmSignUpAddress({ token: "tok" }),
        confirmSignUpAddress({ token: "tok" }),
      ];
      const answers = await Promise.all(whileInFlight);
      const afterwards = await confirmSignUpAddress({ token: "tok" });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(answers).toEqual([ANSWER, ANSWER]);
      expect(afterwards).toEqual(ANSWER);
    });
  });
});

describe("given a confirmation link whose spend was refused", () => {
  describe("when the screen asks to spend it again", () => {
    /** @scenario "A refused spend can be asked again" */
    it("asks the server again", async () => {
      fetchMock
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ code: "identity_verification_used" }), { status: 410 }),
        )
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValueOnce(new Response(JSON.stringify(ANSWER), { status: 200 }));

      await expect(confirmSignUpAddress({ token: "tok" })).rejects.toMatchObject({ status: 410 });
      await expect(confirmSignUpAddress({ token: "tok" })).rejects.toThrow("Failed to fetch");
      await expect(confirmSignUpAddress({ token: "tok" })).resolves.toEqual(ANSWER);

      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });
});
