/**
 * Auth's passkey ceremonies, lent to the screen where a reader manages their
 * own. Travels by declaration, so a peer never imports this closed package
 * (ARCHITECTURE.md §10.1, kit rule 7).
 */

import {
  listUiPasskeys,
  registerUiPasskey,
  removeUiPasskey,
  renameUiPasskey,
  type UiPasskey,
  type UiPasskeyOutcome,
} from "./ui-passkeys.ts";

export const passkeyCapability = {
  list: (): Promise<readonly UiPasskey[]> => listUiPasskeys(),
  register: (): Promise<UiPasskeyOutcome> => registerUiPasskey(),
  rename: (input: { id: string; name: string }): Promise<UiPasskeyOutcome> =>
    renameUiPasskey(input),
  remove: (input: { id: string }): Promise<UiPasskeyOutcome> => removeUiPasskey(input),
};

export default passkeyCapability;
