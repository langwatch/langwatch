/**
 * The in-memory shop data: accounts, their plan, and their orders.
 *
 * A real application reads this from a database. The demo keeps it in a map so
 * the whole flow runs with no infrastructure.
 */

/** A refund above this amount is only available on the pro plan. */
export const REFUND_LIMIT_FREE = 50;

export interface Order {
  id: string;
  item: string;
  total: number;
  status: string;
  refunded: number;
}

export interface Account {
  id: string;
  plan: "free" | "pro";
  orders: Map<string, Order>;
}

const account = (id: string, plan: "free" | "pro", orders: Omit<Order, "refunded">[]): Account => ({
  id,
  plan,
  orders: new Map(orders.map((order) => [order.id, { ...order, refunded: 0 }])),
});

export const accounts = new Map<string, Account>([
  [
    "acme-free",
    account("acme-free", "free", [
      { id: "A-1001", item: "Blue Mug", total: 24.0, status: "delivered" },
      { id: "A-1002", item: "Desk Lamp", total: 89.5, status: "delivered" },
    ]),
  ],
  [
    "acme-pro",
    account("acme-pro", "pro", [
      { id: "A-2001", item: "Office Chair", total: 249.0, status: "delivered" },
      { id: "A-2002", item: "Keyboard", total: 79.9, status: "delivered" },
    ]),
  ],
]);

const getAccount = (accountId: string): Account => {
  const found = accounts.get(accountId);
  if (!found) throw new Error(`unknown account ${accountId}`);
  return found;
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** The order as the agent sees it, or a not-found answer. */
export function lookupOrder({ accountId, orderId }: { accountId: string; orderId: string }) {
  const shop = getAccount(accountId);
  const order = shop.orders.get(orderId.trim().toUpperCase());
  if (!order) {
    return { found: false, orderId, knownOrders: [...shop.orders.keys()].sort() };
  }
  return {
    found: true,
    orderId: order.id,
    item: order.item,
    total: order.total,
    status: order.status,
    refunded: order.refunded,
  };
}

/** Refund an order, or refuse with the reason the agent must explain. */
export function refundOrder({
  accountId,
  orderId,
  amount,
}: {
  accountId: string;
  orderId: string;
  amount: number;
}) {
  const shop = getAccount(accountId);
  const order = shop.orders.get(orderId.trim().toUpperCase());
  if (!order) return { ok: false, reason: "order_not_found", orderId };
  if (!(amount > 0)) return { ok: false, reason: "invalid_amount", amount };
  if (amount > order.total - order.refunded) {
    return {
      ok: false,
      reason: "amount_above_order_total",
      orderId: order.id,
      refundable: round2(order.total - order.refunded),
    };
  }
  if (amount > REFUND_LIMIT_FREE && shop.plan !== "pro") {
    return {
      ok: false,
      reason: "plan_limit",
      plan: shop.plan,
      limit: REFUND_LIMIT_FREE,
      escalation: "a human support agent can approve it",
    };
  }
  order.refunded = round2(order.refunded + amount);
  return {
    ok: true,
    orderId: order.id,
    refundedNow: round2(amount),
    refundedTotal: order.refunded,
  };
}
