import {
  type BillingApi,
  SubscriptionAlreadyActiveError,
  type SubscriptionWrite,
} from "@langwatch/enterprise-billing-contract";
import { ValidationError } from "@langwatch/handled-error";
import {
  AdminSubscriptionAlreadyActiveError,
  AdminSubscriptionIdsRequiredError,
  type AdminOperationInput,
} from "@langwatch/ops-contract";

/** Billing's one-live-plan rule, asked before Cloud admin writes a subscription row. */
export type AdminSubscriptionRule = Pick<BillingApi, "assertSubscriptionWriteAllowed">;

const PLAIN_STRING_FIELDS = ["status", "organizationId", "plan"] as const;
const WRITE_METHODS = new Set<string>(["create", "update", "updateMany"]);

/** A Cloud admin subscription write, held to the one live plan billing allows an organization. */
export class AdminSubscriptionWriteService {
  static create({ billing }: { billing: AdminSubscriptionRule }): AdminSubscriptionWriteService {
    return new AdminSubscriptionWriteService(billing);
  }

  private constructor(private readonly billing: AdminSubscriptionRule) {}

  /**
   * The writes an edit makes, asked of billing before anything is audited or written; none for
   * any other edit. A refusal names the live rows to edit or cancel instead.
   */
  async check(input: AdminOperationInput): Promise<SubscriptionWrite[]> {
    if (input.resource !== "subscription" || !WRITE_METHODS.has(input.method)) return [];
    const writes = this.writesOf(input);
    await this.ask(writes);
    return writes;
  }

  /**
   * Runs the checked write. A write that fails after another landed first is asked again, so a
   * lost race answers billing's refusal instead of the database's.
   */
  async written<T>({
    writes,
    write,
  }: {
    writes: readonly SubscriptionWrite[];
    write: () => Promise<T>;
  }): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (writes.length > 0) await this.ask(writes);
      throw error;
    }
  }

  private async ask(writes: readonly SubscriptionWrite[]): Promise<void> {
    try {
      await this.billing.assertSubscriptionWriteAllowed({ writes });
    } catch (error) {
      if (!(error instanceof SubscriptionAlreadyActiveError)) throw error;
      const { organizationId, liveSubscriptionIds } = error.meta;
      throw new AdminSubscriptionAlreadyActiveError({
        organizationId: typeof organizationId === "string" ? organizationId : "",
        activeSubscriptionIds: Array.isArray(liveSubscriptionIds)
          ? liveSubscriptionIds.map(String)
          : [],
      });
    }
  }

  /**
   * The check must see what persists, so an operator object (`{ set: "ACTIVE" }`) is refused,
   * and a bulk edit must list its ids so no write reaches rows the check did not read.
   */
  private writesOf(input: AdminOperationInput): SubscriptionWrite[] {
    const data = input.params.data ?? {};
    const nonPlain = [
      ...PLAIN_STRING_FIELDS.filter(
        (field) => data[field] !== undefined && typeof data[field] !== "string",
      ),
      ...(data.stripeSubscriptionId === undefined ||
      data.stripeSubscriptionId === null ||
      typeof data.stripeSubscriptionId === "string"
        ? []
        : ["stripeSubscriptionId"]),
    ];
    if (nonPlain.length > 0) {
      throw new ValidationError(
        "A subscription's status, organization, plan and link are plain values",
        {
          meta: {
            fieldErrors: Object.fromEntries(
              nonPlain.map((field) => [field, ["Send a plain value."]]),
            ),
          },
        },
      );
    }
    const fields: SubscriptionWrite = {
      organizationId: data.organizationId as string | undefined,
      status: data.status as string | undefined,
      plan: data.plan as string | undefined,
      stripeSubscriptionId: data.stripeSubscriptionId as string | null | undefined,
    };
    return this.idsOf(input).map((id) => (id === undefined ? fields : { ...fields, id }));
  }

  /** A create names no stored row yet; an update its one; a bulk edit must list its ids. */
  private idsOf(input: AdminOperationInput): (string | undefined)[] {
    if (input.method === "create") return [undefined];
    if (input.method === "update") return [String(input.params.id ?? "")];
    const ids: unknown = input.params.ids;
    if (!Array.isArray(ids) || ids.length === 0) throw new AdminSubscriptionIdsRequiredError();
    return ids.map(String);
  }
}
