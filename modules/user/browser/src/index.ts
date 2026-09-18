/**
 * Exports processAvatarImage, tested in platform/app's presentation registry.
 * Root export is an ADR-004 exception; move when registry becomes testable.
 */

export {
  AVATAR_MAX_SOURCE_BYTES,
  AVATAR_OUTPUT_SIZE,
  AvatarImageError,
  AvatarImageProcessingFailedError,
  processAvatarImage,
} from "./model/process-avatar-image.ts";
