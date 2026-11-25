/**
 * Whether this is a release build. The release image build rewrites this line to `true` in its
 * builder stage (infra/docker/Dockerfile); runtime env cannot change it. Dev and test keep `false`.
 */
export const isReleaseBuild: boolean = false;
