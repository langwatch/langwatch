/** The device-approval page `langwatch login` opens; it sends a new account here as the
 *  continuation. */
const CLI_DEVICE_APPROVAL_PATH = "/cli/auth";

/**
 * Where a join request made from the welcome screen comes from (ADR-171 v6): `cli` when the
 * continuation is the device-approval page, `web` otherwise. Decided in the browser because the
 * origin only ever LOWERS the seat a request lands in, so a lying client gets less, never more.
 */
export function joinOriginOf({ returnTo }: { returnTo: string | null | undefined }): "web" | "cli" {
  if (typeof returnTo !== "string") return "web";
  return returnTo === CLI_DEVICE_APPROVAL_PATH ||
    returnTo.startsWith(`${CLI_DEVICE_APPROVAL_PATH}?`)
    ? "cli"
    : "web";
}
