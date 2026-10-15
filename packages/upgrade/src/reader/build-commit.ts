/**
 * The short git commit this image was built from. The Dockerfile rewrites this line from its
 * LANGWATCH_BUILD_COMMIT build arg, as it stamps isReleaseBuild; a checkout keeps null.
 */
export const buildCommit: string | null = null;
