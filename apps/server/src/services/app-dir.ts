import { checkoutRoot, installedAppDir } from "../shared/app-location.ts";
import { paths } from "../shared/paths.ts";
import { CLI_VERSION } from "../shared/version.ts";

/**
 * The app tree every service runs from: the checkout in place for `pnpm dev:cli`, else the
 * prebuilt app the `app` predep installed for this CLI's release (ADR-180).
 */
export function appRoot(): string {
  return checkoutRoot() ?? installedAppDir({ appsDir: paths.app, version: CLI_VERSION });
}
