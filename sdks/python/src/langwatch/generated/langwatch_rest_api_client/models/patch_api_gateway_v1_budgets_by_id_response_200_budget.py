from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.patch_api_gateway_v1_budgets_by_id_response_200_budget_on_breach import (
    PatchApiGatewayV1BudgetsByIdResponse200BudgetOnBreach,
)
from ..models.patch_api_gateway_v1_budgets_by_id_response_200_budget_scope_reach import (
    PatchApiGatewayV1BudgetsByIdResponse200BudgetScopeReach,
)
from ..models.patch_api_gateway_v1_budgets_by_id_response_200_budget_scope_type import (
    PatchApiGatewayV1BudgetsByIdResponse200BudgetScopeType,
)
from ..models.patch_api_gateway_v1_budgets_by_id_response_200_budget_window import (
    PatchApiGatewayV1BudgetsByIdResponse200BudgetWindow,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.patch_api_gateway_v1_budgets_by_id_response_200_budget_metadata import (
        PatchApiGatewayV1BudgetsByIdResponse200BudgetMetadata,
    )


T = TypeVar("T", bound="PatchApiGatewayV1BudgetsByIdResponse200Budget")


@_attrs_define
class PatchApiGatewayV1BudgetsByIdResponse200Budget:
    """
    Attributes:
        id (str):
        organization_id (str):
        scope_type (PatchApiGatewayV1BudgetsByIdResponse200BudgetScopeType):
        scope_id (str):
        name (str):
        description (None | str):
        window (PatchApiGatewayV1BudgetsByIdResponse200BudgetWindow):
        on_breach (PatchApiGatewayV1BudgetsByIdResponse200BudgetOnBreach):
        limit_usd (str): Display value. Decimal string, up to 9 fractional digits, trailing zeros trimmed, never
            exponent notation. Use limit_nano_usd for arithmetic.
        limit_nano_usd (int | None): Canonical integer amount, nano-USD. Null past the safe integer range, where
            limit_usd still reads.
        spent_usd (None | str): Display value, null when spend_available is false. Decimal string, up to 9 fractional
            digits, trailing zeros trimmed, never exponent notation. Use spent_nano_usd for arithmetic.
        spent_nano_usd (int | None): Canonical integer spend, nano-USD. Null when spend is unavailable. Derived from the
            same integer as spent_usd, so the pair always agrees.
        timezone (None | str):
        provider_key (None | str):
        external_id (None | str):
        metadata (PatchApiGatewayV1BudgetsByIdResponse200BudgetMetadata):
        current_period_started_at (str): Start of the period `spent_usd` covers, computed at read time. For an anchored
            budget this is its own cycle's start, not the calendar period's.
        resets_at (str): When the current period gives way to the next. Far-future for total and manual windows, which
            do not roll on their own.
        cycle_anchor_at (None | str): The instant this budget's cycle is phased to. Null means no anchor: a calendar-
            aligned cyclic window, or one of the two windows that do not cycle (total, manual).
        last_reset_at (None | str):
        archived_at (None | str):
        created_at (str):
        member_count (int | Unset):
        end_users_seen (int | Unset):
        end_users_over (int | Unset):
        scope_reach (PatchApiGatewayV1BudgetsByIdResponse200BudgetScopeReach | Unset): Whether any active key in the
            organization can produce traffic this budget matches. `unreachable` means it will never accrue and never block
            as configured: scope a key to its target, or move the budget where the keys already run. This is the only field
            that tells a budget nothing can reach apart from one that simply has not been breached.
    """

    id: str
    organization_id: str
    scope_type: PatchApiGatewayV1BudgetsByIdResponse200BudgetScopeType
    scope_id: str
    name: str
    description: None | str
    window: PatchApiGatewayV1BudgetsByIdResponse200BudgetWindow
    on_breach: PatchApiGatewayV1BudgetsByIdResponse200BudgetOnBreach
    limit_usd: str
    limit_nano_usd: int | None
    spent_usd: None | str
    spent_nano_usd: int | None
    timezone: None | str
    provider_key: None | str
    external_id: None | str
    metadata: PatchApiGatewayV1BudgetsByIdResponse200BudgetMetadata
    current_period_started_at: str
    resets_at: str
    cycle_anchor_at: None | str
    last_reset_at: None | str
    archived_at: None | str
    created_at: str
    member_count: int | Unset = UNSET
    end_users_seen: int | Unset = UNSET
    end_users_over: int | Unset = UNSET
    scope_reach: PatchApiGatewayV1BudgetsByIdResponse200BudgetScopeReach | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        organization_id = self.organization_id

        scope_type = self.scope_type.value

        scope_id = self.scope_id

        name = self.name

        description: None | str
        description = self.description

        window = self.window.value

        on_breach = self.on_breach.value

        limit_usd = self.limit_usd

        limit_nano_usd: int | None
        limit_nano_usd = self.limit_nano_usd

        spent_usd: None | str
        spent_usd = self.spent_usd

        spent_nano_usd: int | None
        spent_nano_usd = self.spent_nano_usd

        timezone: None | str
        timezone = self.timezone

        provider_key: None | str
        provider_key = self.provider_key

        external_id: None | str
        external_id = self.external_id

        metadata = self.metadata.to_dict()

        current_period_started_at = self.current_period_started_at

        resets_at = self.resets_at

        cycle_anchor_at: None | str
        cycle_anchor_at = self.cycle_anchor_at

        last_reset_at: None | str
        last_reset_at = self.last_reset_at

        archived_at: None | str
        archived_at = self.archived_at

        created_at = self.created_at

        member_count = self.member_count

        end_users_seen = self.end_users_seen

        end_users_over = self.end_users_over

        scope_reach: str | Unset = UNSET
        if not isinstance(self.scope_reach, Unset):
            scope_reach = self.scope_reach.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "organization_id": organization_id,
                "scope_type": scope_type,
                "scope_id": scope_id,
                "name": name,
                "description": description,
                "window": window,
                "on_breach": on_breach,
                "limit_usd": limit_usd,
                "limit_nano_usd": limit_nano_usd,
                "spent_usd": spent_usd,
                "spent_nano_usd": spent_nano_usd,
                "timezone": timezone,
                "provider_key": provider_key,
                "external_id": external_id,
                "metadata": metadata,
                "current_period_started_at": current_period_started_at,
                "resets_at": resets_at,
                "cycle_anchor_at": cycle_anchor_at,
                "last_reset_at": last_reset_at,
                "archived_at": archived_at,
                "created_at": created_at,
            }
        )
        if member_count is not UNSET:
            field_dict["member_count"] = member_count
        if end_users_seen is not UNSET:
            field_dict["end_users_seen"] = end_users_seen
        if end_users_over is not UNSET:
            field_dict["end_users_over"] = end_users_over
        if scope_reach is not UNSET:
            field_dict["scope_reach"] = scope_reach

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.patch_api_gateway_v1_budgets_by_id_response_200_budget_metadata import (
            PatchApiGatewayV1BudgetsByIdResponse200BudgetMetadata,
        )

        d = dict(src_dict)
        id = d.pop("id")

        organization_id = d.pop("organization_id")

        scope_type = PatchApiGatewayV1BudgetsByIdResponse200BudgetScopeType(d.pop("scope_type"))

        scope_id = d.pop("scope_id")

        name = d.pop("name")

        def _parse_description(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        description = _parse_description(d.pop("description"))

        window = PatchApiGatewayV1BudgetsByIdResponse200BudgetWindow(d.pop("window"))

        on_breach = PatchApiGatewayV1BudgetsByIdResponse200BudgetOnBreach(d.pop("on_breach"))

        limit_usd = d.pop("limit_usd")

        def _parse_limit_nano_usd(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        limit_nano_usd = _parse_limit_nano_usd(d.pop("limit_nano_usd"))

        def _parse_spent_usd(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        spent_usd = _parse_spent_usd(d.pop("spent_usd"))

        def _parse_spent_nano_usd(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        spent_nano_usd = _parse_spent_nano_usd(d.pop("spent_nano_usd"))

        def _parse_timezone(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        timezone = _parse_timezone(d.pop("timezone"))

        def _parse_provider_key(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        provider_key = _parse_provider_key(d.pop("provider_key"))

        def _parse_external_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        external_id = _parse_external_id(d.pop("external_id"))

        metadata = PatchApiGatewayV1BudgetsByIdResponse200BudgetMetadata.from_dict(d.pop("metadata"))

        current_period_started_at = d.pop("current_period_started_at")

        resets_at = d.pop("resets_at")

        def _parse_cycle_anchor_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        cycle_anchor_at = _parse_cycle_anchor_at(d.pop("cycle_anchor_at"))

        def _parse_last_reset_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        last_reset_at = _parse_last_reset_at(d.pop("last_reset_at"))

        def _parse_archived_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        archived_at = _parse_archived_at(d.pop("archived_at"))

        created_at = d.pop("created_at")

        member_count = d.pop("member_count", UNSET)

        end_users_seen = d.pop("end_users_seen", UNSET)

        end_users_over = d.pop("end_users_over", UNSET)

        _scope_reach = d.pop("scope_reach", UNSET)
        scope_reach: PatchApiGatewayV1BudgetsByIdResponse200BudgetScopeReach | Unset
        if isinstance(_scope_reach, Unset):
            scope_reach = UNSET
        else:
            scope_reach = PatchApiGatewayV1BudgetsByIdResponse200BudgetScopeReach(_scope_reach)

        patch_api_gateway_v1_budgets_by_id_response_200_budget = cls(
            id=id,
            organization_id=organization_id,
            scope_type=scope_type,
            scope_id=scope_id,
            name=name,
            description=description,
            window=window,
            on_breach=on_breach,
            limit_usd=limit_usd,
            limit_nano_usd=limit_nano_usd,
            spent_usd=spent_usd,
            spent_nano_usd=spent_nano_usd,
            timezone=timezone,
            provider_key=provider_key,
            external_id=external_id,
            metadata=metadata,
            current_period_started_at=current_period_started_at,
            resets_at=resets_at,
            cycle_anchor_at=cycle_anchor_at,
            last_reset_at=last_reset_at,
            archived_at=archived_at,
            created_at=created_at,
            member_count=member_count,
            end_users_seen=end_users_seen,
            end_users_over=end_users_over,
            scope_reach=scope_reach,
        )

        patch_api_gateway_v1_budgets_by_id_response_200_budget.additional_properties = d
        return patch_api_gateway_v1_budgets_by_id_response_200_budget

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
