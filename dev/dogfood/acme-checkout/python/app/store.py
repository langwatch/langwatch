"""The store data: the guest cart, the discount codes, the payment gateway and
the order numbers.

A real store reads the cart from a session and charges a payment provider. The
demo keeps everything in this module and makes every outcome deterministic, so
a conversation can be replayed and checked.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import date

#: Flat shipping, in dollars.
SHIPPING = 6.90


@dataclass(frozen=True)
class CartLine:
    sku: str
    name: str
    unit_price: float
    quantity: int

    @property
    def total(self) -> float:
        return round(self.unit_price * self.quantity, 2)


#: The cart every guest arrives with.
GUEST_CART: tuple[CartLine, ...] = (
    CartLine(sku="MUG-BLUE", name="Blue Mug", unit_price=24.00, quantity=2),
    CartLine(sku="LAMP-DESK", name="Desk Lamp", unit_price=89.50, quantity=1),
)


@dataclass(frozen=True)
class DiscountCode:
    code: str
    percent_off: int
    #: None never expires.
    expires_on: date | None

    def is_expired(self, *, today: date) -> bool:
        return self.expires_on is not None and self.expires_on < today


DISCOUNT_CODES: dict[str, DiscountCode] = {
    "WELCOME10": DiscountCode(code="WELCOME10", percent_off=10, expires_on=None),
    "SPRING25": DiscountCode(
        code="SPRING25", percent_off=25, expires_on=date(2026, 3, 31)
    ),
}


def cart_totals(*, discount_code: str | None) -> dict:
    """The cart as the agent reads it back to the guest, with the totals."""
    subtotal = round(sum(line.total for line in GUEST_CART), 2)
    discount = DISCOUNT_CODES.get(discount_code or "")
    discount_amount = (
        round(subtotal * discount.percent_off / 100, 2) if discount else 0.0
    )
    return {
        "lines": [
            {
                "sku": line.sku,
                "name": line.name,
                "unit_price": line.unit_price,
                "quantity": line.quantity,
                "total": line.total,
            }
            for line in GUEST_CART
        ],
        "subtotal": subtotal,
        "discount_code": discount.code if discount else None,
        "discount": discount_amount,
        "shipping": SHIPPING,
        "total": round(subtotal - discount_amount + SHIPPING, 2),
        "currency": "USD",
    }


def check_discount_code(*, code: str, today: date | None = None) -> dict:
    """Whether a code applies, or the reason the agent must give for refusing it."""
    normalized = code.strip().upper()
    discount = DISCOUNT_CODES.get(normalized)
    if discount is None:
        return {"ok": False, "reason": "unknown_code", "code": normalized}
    if discount.is_expired(today=today or date.today()):
        return {
            "ok": False,
            "reason": "expired",
            "code": discount.code,
            "expired_on": discount.expires_on.isoformat()
            if discount.expires_on
            else None,
        }
    return {"ok": True, "code": discount.code, "percent_off": discount.percent_off}


def charge(*, card_number: str, amount: float) -> dict:
    """The fake payment gateway: approves every card but one, and moves no money.

    A card number of 12 to 19 digits is approved. A number that ends in 0000
    is declined, which is how a conversation reaches the declined path on
    purpose.
    """
    digits = "".join(character for character in card_number if character.isdigit())
    if not 12 <= len(digits) <= 19:
        return {"ok": False, "reason": "invalid_card_number"}
    if digits.endswith("0000"):
        return {"ok": False, "reason": "declined", "last4": digits[-4:]}
    cents = int(round(amount * 100))
    return {
        "ok": True,
        "payment_id": f"pay_{digits[-4:]}_{cents}",
        "last4": digits[-4:],
        "amount": amount,
        "currency": "USD",
    }


def order_number(*, thread_id: str) -> str:
    """The order number of a conversation, the same one every time it is asked."""
    digest = hashlib.sha1(thread_id.encode("utf8")).hexdigest()[:6].upper()
    return f"ACME-{digest}"
