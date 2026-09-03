import type {
  AttachGrantCommandData,
  ChangeGrantRoleCommandData,
  ChangeRolePermissionsCommandData,
  DefineRoleCommandData,
  DeleteRoleCommandData,
  RevokeGrantCommandData,
} from "@langwatch/authz-contract";
export { AuthzLedgerUnavailableError } from "@langwatch/authz-contract";

type AuthzCommandSender<Payload> = {
  send(data: Payload): Promise<unknown>;
};

export type AuthzGrantsCommandSenders = {
  attachGrant: AuthzCommandSender<AttachGrantCommandData>;
  changeGrantRole: AuthzCommandSender<ChangeGrantRoleCommandData>;
  revokeGrant: AuthzCommandSender<RevokeGrantCommandData>;
  defineRole: AuthzCommandSender<DefineRoleCommandData>;
  changeRolePermissions: AuthzCommandSender<ChangeRolePermissionsCommandData>;
  deleteRole: AuthzCommandSender<DeleteRoleCommandData>;
};

/** Runtime-owned command resolution; implementations may cache per instance. */
export abstract class AuthzGrantsCommandDispatcher {
  abstract commands(): Promise<{ commands: AuthzGrantsCommandSenders }>;
}

export const LEDGER_APP_HANDLE_WAIT_MS = 5_000;
