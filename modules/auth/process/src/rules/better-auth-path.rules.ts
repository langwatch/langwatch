/** The CLI plane's prefix: its families mount after `/api/auth` and own everything under it. */
const CLI_PLANE = "/api/auth/cli";

/** Whether a path under `/api/auth/*` is Better Auth's to answer, rather than the CLI plane's. */
export function isBetterAuthPath({ pathname }: { pathname: string }): boolean {
  return pathname !== CLI_PLANE && !pathname.startsWith(`${CLI_PLANE}/`);
}
