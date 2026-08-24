import type {
  AttachGrantCommandData,
  ChangeGrantRoleCommandData,
  ChangeRolePermissionsCommandData,
  DefineRoleCommandData,
  DeleteRoleCommandData,
  RevokeGrantCommandData,
} from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";

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

export class AuthzLedgerUnavailableError extends HandledError {
  declare readonly code: "authz_ledger_unavailable";

  constructor() {
    super(
      "authz_ledger_unavailable",
      "Access changes are temporarily unavailable. Try again in a moment.",
      { httpStatus: 503, fault: "platform" },
    );
    this.name = "AuthzLedgerUnavailableError";
  }
}

export const LEDGER_APP_HANDLE_WAIT_MS = 5_000;
