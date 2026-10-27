from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="ReadCliBootstrapResponse200Budget")


@_attrs_define
class ReadCliBootstrapResponse200Budget:
    """
    Attributes:
        monthly_limit_usd (float | None):
        monthly_used_usd (float):
        period (Literal['MONTHLY']):
    """

    monthly_limit_usd: float | None
    monthly_used_usd: float
    period: Literal["MONTHLY"]

    def to_dict(self) -> dict[str, Any]:
        monthly_limit_usd: float | None
        monthly_limit_usd = self.monthly_limit_usd

        monthly_used_usd = self.monthly_used_usd

        period = self.period

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "monthlyLimitUsd": monthly_limit_usd,
                "monthlyUsedUsd": monthly_used_usd,
                "period": period,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)

        def _parse_monthly_limit_usd(data: object) -> float | None:
            if data is None:
                return data
            return cast(float | None, data)

        monthly_limit_usd = _parse_monthly_limit_usd(d.pop("monthlyLimitUsd"))

        monthly_used_usd = d.pop("monthlyUsedUsd")

        period = cast(Literal["MONTHLY"], d.pop("period"))
        if period != "MONTHLY":
            raise ValueError(f"period must match const 'MONTHLY', got '{period}'")

        read_cli_bootstrap_response_200_budget = cls(
            monthly_limit_usd=monthly_limit_usd,
            monthly_used_usd=monthly_used_usd,
            period=period,
        )

        return read_cli_bootstrap_response_200_budget
