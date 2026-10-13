/** `version` and `versionId` each pick one version of a prompt, so only one may be given. */
export function assertOneVersionSelector(options: { version?: number; versionId?: string }): void {
  if (options.version && options.versionId) {
    throw new Error("Cannot specify both version and versionId");
  }
}
