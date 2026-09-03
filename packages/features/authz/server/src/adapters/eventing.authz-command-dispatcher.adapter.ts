import {
  AuthzGrantsCommandDispatcher,
  type AuthzGrantsCommandSenders,
  AuthzLedgerUnavailableError,
  LEDGER_APP_HANDLE_WAIT_MS,
} from "../ports/authz-grants-command-dispatcher.port";

type UntypedSender = { send(data: unknown): Promise<unknown> };

function isSender(value: unknown): value is UntypedSender {
  if (typeof value !== "object" || value === null || !("send" in value)) return false;
  return typeof value.send === "function";
}

/**
 * The late binding between the grants ledger and the Eventing registration
 * that produces its command senders.
 *
 * Both ends are unavoidably out of order. The AuthZ service graph is built
 * from a database and a Redis, and the pipeline whose `commands` this needs is
 * a product OF that graph — `PostgresAuthzAdapter.build()` returns the ledger
 * and the pipeline definition together, and only then can a runtime register
 * it. So the dispatcher exists first and is connected afterwards, in every
 * process that composes AuthZ.
 *
 * What it must not do is silently fall through. A write that arrives before
 * `connect` waits, bounded, and then refuses with
 * {@link AuthzLedgerUnavailableError}: an organization whose genesis import has
 * landed writes through the ledger, and taking the imperative Prisma path
 * instead because a registration was late would write rows the ledger never
 * hears about.
 *
 * A second `connect` with a DIFFERENT set of senders is a composition bug
 * rather than a race — two registrations of one pipeline in one process means
 * two producers for one aggregate — and it throws. Connecting the same senders
 * twice is idempotent, so an installer that runs again finds nothing to do.
 */
export class EventingAuthzCommandDispatcherAdapter extends AuthzGrantsCommandDispatcher {
  static create(options: { waitMs?: number } = {}): EventingAuthzCommandDispatcherAdapter {
    return new EventingAuthzCommandDispatcherAdapter(options.waitMs ?? LEDGER_APP_HANDLE_WAIT_MS);
  }

  /**
   * Narrows what an Eventing registration handed back to the senders the ledger
   * writes through.
   *
   * A runtime's `commands` map is keyed by strings and typed by the definition's
   * generic parameters, which the AuthZ pipeline widens to `any` so its private
   * projection and store types stay private. Every process that connected one
   * therefore reached for an unchecked assertion — and an assertion is exactly
   * the wrong tool here, because the failure it hides is a pipeline registered
   * without one of its commands, which surfaces as `undefined.send is not a
   * function` on the first grant a customer changes.
   *
   * This checks instead, once, in the package that owns the six names.
   */
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
