from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="ReadCliBudgetStatusResponse402Error")


@_attrs_define
class ReadCliBudgetStatusResponse402Error:
    """
    Attributes:
        type_ (Literal['budget_exceeded']):
        scope (str):
        limit_usd (str):
        spent_usd (str):
        period (str):
        request_increase_url (str):
        admin_email (None | str):
    """

    type_: Literal["budget_exceeded"]
    scope: str
    limit_usd: str
    spent_usd: str
    period: str
    request_increase_url: str
    admin_email: None | str

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        scope = self.scope

        limit_usd = self.limit_usd

        spent_usd = self.spent_usd

        period = self.period

        request_increase_url = self.request_increase_url

        admin_email: None | str
        admin_email = self.admin_email

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
                "scope": scope,
                "limit_usd": limit_usd,
                "spent_usd": spent_usd,
                "period": period,
                "request_increase_url": request_increase_url,
                "admin_email": admin_email,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = cast(Literal["budget_exceeded"], d.pop("type"))
        if type_ != "budget_exceeded":
            raise ValueError(f"type must match const 'budget_exceeded', got '{type_}'")

        scope = d.pop("scope")

        limit_usd = d.pop("limit_usd")

        spent_usd = d.pop("spent_usd")

        period = d.pop("period")

        request_increase_url = d.pop("request_increase_url")

        def _parse_admin_email(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        admin_email = _parse_admin_email(d.pop("admin_email"))

        read_cli_budget_status_response_402_error = cls(
            type_=type_,
            scope=scope,
            limit_usd=limit_usd,
            spent_usd=spent_usd,
            period=period,
            request_increase_url=request_increase_url,
            admin_email=admin_email,
        )

        return read_cli_budget_status_response_402_error
