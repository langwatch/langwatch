/**
 * What this package publishes outside its own screens.
 *
 * ONE THING, and it is here for one caller: `processAvatarImage` and the
 * refusals it raises, which `platform/app`'s
 * `components/me/avatar/__tests__/processAvatarImage.unit.test.ts` drives
 * against the application's code-keyed presentation registry. That test proves
 * the browser and the server refuse an oversized photo for the same reason, and
 * that a rate-limited change reads as a wait rather than as an unknown error —
 * and the registry it asserts against is still a `platform/app` module, so the
 * test cannot travel with the code it exercises.
 *
 * ADR-004 allows a feature-web package only `screens/<owner>` and
 * `surfaces/<id>` entries, so this root entry is a known finding rather than an
 * oversight — the same one `@langwatch/gateway-web` and
 * `@langwatch/enterprise-governance-web` carry. It goes when the presentation
 * registry moves into a package the test can import from either side.
 */

export {
  AVATAR_MAX_SOURCE_BYTES,
  AVATAR_OUTPUT_SIZE,
  AvatarImageError,
  AvatarImageProcessingFailedError,
  processAvatarImage,
} from "./model/process-avatar-image";
