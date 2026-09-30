"""The in-memory shop data: accounts, their plan, and their orders.

A real application reads this from a database. The demo keeps it in a
dictionary so the whole flow runs with no infrastructure.
"""

from __future__ import annotations

from dataclasses import dataclass, field

#: A refund above this amount is only available on the pro plan.
REFUND_LIMIT_FREE = 50.0


@dataclass
class Order:
    id: str
    item: str
    total: float
    status: str
    refunded: float = 0.0


@dataclass
class Account:
    id: str
    plan: str
    orders: dict[str, Order] = field(default_factory=dict)


def _account(id: str, plan: str, orders: list[Order]) -> Account:
    return Account(id=id, plan=plan, orders={order.id: order for order in orders})


ACCOUNTS: dict[str, Account] = {
    "acme-free": _account(
        "acme-free",
        "free",
        [
            Order(id="A-1001", item="Blue Mug", total=24.00, status="delivered"),
            Order(id="A-1002", item="Desk Lamp", total=89.50, status="delivered"),
        ],
    ),
    "acme-pro": _account(
        "acme-pro",
        "pro",
        [
            Order(id="A-2001", item="Office Chair", total=249.00, status="delivered"),
            Order(id="A-2002", item="Keyboard", total=79.90, status="delivered"),
        ],
    ),
}


class UnknownAccountError(ValueError):
    """The account id is not in the store."""


def get_account(account_id: str) -> Account:
    account = ACCOUNTS.get(account_id)
    if account is None:
        raise UnknownAccountError(f"unknown account {account_id}")
    return account


def lookup_order(*, account_id: str, order_id: str) -> dict:
    """The order as the agent sees it, or a not_found answer."""
    account = get_account(account_id)
    order = account.orders.get(order_id.strip().upper())
    if order is None:
        return {
            "found": False,
            "order_id": order_id,
            "known_orders": sorted(account.orders),
        }
    return {
        "found": True,
        "order_id": order.id,
        "item": order.item,
        "total": order.total,
        "status": order.status,
        "refunded": order.refunded,
    }


def refund_order(*, account_id: str, order_id: str, amount: float) -> dict:
    """Refund an order, or refuse with the reason the agent must explain."""
    account = get_account(account_id)
    order = account.orders.get(order_id.strip().upper())
    if order is None:
        return {"ok": False, "reason": "order_not_found", "order_id": order_id}
    if amount <= 0:
        return {"ok": False, "reason": "invalid_amount", "amount": amount}
    if amount > order.total - order.refunded:
        return {
            "ok": False,
            "reason": "amount_above_order_total",
            "order_id": order.id,
            "refundable": round(order.total - order.refunded, 2),
        }
    if amount > REFUND_LIMIT_FREE and account.plan != "pro":
        return {
            "ok": False,
            "reason": "plan_limit",
            "plan": account.plan,
            "limit": REFUND_LIMIT_FREE,
            "escalation": "a human support agent can approve it",
        }
    order.refunded = round(order.refunded + amount, 2)
    return {
        "ok": True,
        "order_id": order.id,
        "refunded_now": round(amount, 2),
        "refunded_total": order.refunded,
    }
