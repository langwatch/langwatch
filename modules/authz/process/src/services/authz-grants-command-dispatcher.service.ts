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

import { AuthzLedgerUnavailableError } from "@langwatch/authz-contract";

type UntypedSender = { send(data: unknown): Promise<unknown> };

function isSender(value: unknown): value is UntypedSender {
  if (typeof value !== "object" || value === null || !("send" in value)) return false;
  return typeof value.send === "function";
}

// Late binding; writes wait for connect; duplicate different senders is a bug.
export class AuthzCommandDispatcherService extends AuthzGrantsCommandDispatcher {
  static create(options: { waitMs?: number } = {}): AuthzCommandDispatcherService {
    return new AuthzCommandDispatcherService(options.waitMs ?? LEDGER_APP_HANDLE_WAIT_MS);
  }

  // Check senders at registration time; throw instead of hidden undefined.send errors.
  static sendersFrom(commands: Readonly<Record<string, unknown>>): AuthzGrantsCommandSenders {
    const sender = (name: keyof AuthzGrantsCommandSenders): UntypedSender => {
      const candidate = commands[name];
      if (!isSender(candidate)) {
        throw new Error(
          `AuthZ registration produced no "${name}" command sender; the grants pipeline was registered incompletely.`,
        );
      }
      return candidate;
    };

    const attachGrant = sender("attachGrant");
    const changeGrantRole = sender("changeGrantRole");
    const revokeGrant = sender("revokeGrant");
    const defineRole = sender("defineRole");
    const changeRolePermissions = sender("changeRolePermissions");
    const deleteRole = sender("deleteRole");

    // The return type is the exhaustiveness guard: a seventh sender added to
    // `AuthzGrantsCommandSenders` fails to build here rather than being quietly
    // absent from every process that connects one.
    return {
      attachGrant: { send: (data) => attachGrant.send(data) },
      changeGrantRole: { send: (data) => changeGrantRole.send(data) },
      revokeGrant: { send: (data) => revokeGrant.send(data) },
      defineRole: { send: (data) => defineRole.send(data) },
      changeRolePermissions: { send: (data) => changeRolePermissions.send(data) },
      deleteRole: { send: (data) => deleteRole.send(data) },
    };
  }

  private senders: AuthzGrantsCommandSenders | undefined;
  private readonly waiters = new Set<(senders: AuthzGrantsCommandSenders) => void>();

  private constructor(private readonly waitMs: number) {
    super();
  }

  connect(senders: AuthzGrantsCommandSenders): void {
    if (this.senders && this.senders !== senders) {
      throw new Error("AuthZ command dispatcher is already connected.");
    }
    this.senders = senders;
    for (const resolve of this.waiters) resolve(senders);
    this.waiters.clear();
  }

  async commands(): Promise<{ commands: AuthzGrantsCommandSenders }> {
    if (this.senders) return { commands: this.senders };

    const senders = await new Promise<AuthzGrantsCommandSenders>((resolve, reject) => {
      const onConnected = (value: AuthzGrantsCommandSenders) => {
        clearTimeout(timeout);
        this.waiters.delete(onConnected);
        resolve(value);
      };
      const timeout = setTimeout(() => {
        this.waiters.delete(onConnected);
        reject(new AuthzLedgerUnavailableError());
      }, this.waitMs);
      this.waiters.add(onConnected);
    });
    return { commands: senders };
  }
}
