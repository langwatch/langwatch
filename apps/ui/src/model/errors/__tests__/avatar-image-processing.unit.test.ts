import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";
// Imported from the module rather than the `~/features/errors` barrel: the
// barrel pulls in `showErrorToast`, and with it the toaster and Chakra.
import { explainHandledError, UNKNOWN_ERROR_PRESENTATION } from "@langwatch/handled-error/presentation";
import { UserAvatarRateLimitedError, UserAvatarTooLargeError } from "@langwatch/user-contract";
import {
  AVATAR_MAX_SOURCE_BYTES,
  AvatarImageProcessingFailedError,
  processAvatarImage,
} from "@langwatch/user-web";

/**
 * The pre-flight cases here are the ones that decide before the canvas is
 * touched, which is why they need no DOM: `processAvatarImage` inspects the
 * file's type and size and throws before it ever calls `createObjectURL`.
 */
function makeFile({ type, bytes = 8 }: { type: string; bytes?: number }): File {
  return new File([new Uint8Array(bytes)], "photo", { type });
}

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    if (HandledError.isHandled(err)) return err.code;
    throw err;
  }
  throw new Error("expected the call to throw");
}

describe("avatar upload refusals", () => {
  describe("when the browser prepares the picked file", () => {
    /** @scenario A photo over the ceiling is refused with the size reason */
    it("refuses a file over the ceiling as too large, carrying the ceiling", async () => {
      const oversized = makeFile({
        type: "image/png",
        bytes: AVATAR_MAX_SOURCE_BYTES + 1,
      });

      try {
        await processAvatarImage(oversized);
        throw new Error("expected processAvatarImage to throw");
      } catch (err) {
        expect(HandledError.isHandled(err)).toBe(true);
        const handled = err as HandledError;
        expect(handled.code).toBe("avatar_image_too_large");
        // The registry's copy reads the ceiling off `meta` to say "under 8 MB",
        // so the number has to travel with the refusal.
        expect(handled.meta.maxBytes).toBe(AVATAR_MAX_SOURCE_BYTES);
      }
    });

    /** @scenario A file that is not an image is refused as unusable */
    it("refuses a non-image file as an unusable image", async () => {
      expect(await codeOf(() => processAvatarImage(makeFile({ type: "application/pdf" })))).toBe(
        "avatar_image_unreadable",
      );
    });

    /** @scenario A browser that cannot prepare the photo is not booked as a platform incident */
    it("attributes a failed canvas to the customer, not the platform", () => {
      // `fault` decides log level and alerting, and means "who can act". The
      // canvas runs in the visitor's browser; no deploy of ours changes it, so
      // booking it as `platform` filed a browser quirk as an incident.
      expect(new AvatarImageProcessingFailedError().fault).toBe("customer");
    });
  });

  describe("when the same oversized photo is refused on both sides", () => {
    /** @scenario The browser and the server refuse an oversized photo for the same reason */
    it("gives one reason, whichever half caught it", async () => {
      const fromBrowser = await codeOf(() =>
        processAvatarImage(
          makeFile({
            type: "image/png",
            bytes: AVATAR_MAX_SOURCE_BYTES + 1,
          }),
        ),
      );
      const fromServer = new UserAvatarTooLargeError().code;

      // The whole point of the shared code set: a customer who picks a 20 MB
      // file reads the same sentence whether the browser or the server was
      // the one to say no.
      expect(fromBrowser).toBe(fromServer);
    });
  });

  describe("when the caller changes their photo too often", () => {
    /** @scenario Changing the photo too often is refused with a wait, not an unknown error */
    it("reads as a wait rather than the generic unknown state", () => {
      // Through `serialize()`, because the serialised form is the only one a
      // client ever sees — a live `HandledError` carries `reasons` as `Error`s
      // and never reaches the browser. Building it from the real class rather
      // than a literal keeps the class in the assertion: a typo in its `code`
      // fails here instead of quietly degrading to the unknown state in front
      // of a customer. `tips` and `docsUrl` are optional on the wire and
      // required on the shape, so absent becomes empty.
      const wire = new UserAvatarRateLimitedError().serialize();
      const explained = explainHandledError({
        code: wire.code,
        meta: wire.meta,
        httpStatus: wire.httpStatus,
        fault: wire.fault,
        tips: wire.tips ?? [],
        docsUrl: wire.docsUrl,
        traceId: wire.traceId,
        // Whether a retry is worth taking travels on the wire and the shape
        // requires it, so it is carried through rather than defaulted here.
        retryable: wire.retryable,
        reasons: wire.reasons,
      });

      expect(explained.title).not.toBe(UNKNOWN_ERROR_PRESENTATION.title);
      expect(explained.description).not.toBe(UNKNOWN_ERROR_PRESENTATION.description);
      expect(explained.description.toLowerCase()).toContain("wait");
    });
  });
});
