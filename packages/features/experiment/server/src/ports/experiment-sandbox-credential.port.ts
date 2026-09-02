/**
 * The scoped key a run lends to the code it executes.
 *
 * A run that dispatches agent or workflow code mints a short-lived sandbox API
 * key for it. Minting has no signed-in member to authorize — the run mints for
 * itself — and it needs the project's organization, so the whole of that
 * (the organization lookup and the key service) sits behind one question.
 *
 * `undefined` means the run gets no key: either the project has no
 * organization, or the deployment composes no minting. Both already read that
 * way to the caller, which simply omits the credential.
 */
export abstract class ExperimentSandboxCredentialPort {
  abstract tryMintRunKey(input: { projectId: string }): Promise<string | undefined>;
}
