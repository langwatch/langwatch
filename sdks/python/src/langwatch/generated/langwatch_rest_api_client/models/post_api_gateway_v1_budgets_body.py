from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..models.post_api_gateway_v1_budgets_body_on_breach import PostApiGatewayV1BudgetsBodyOnBreach
from ..models.post_api_gateway_v1_budgets_body_window import PostApiGatewayV1BudgetsBodyWindow
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_gateway_v1_budgets_body_metadata import PostApiGatewayV1BudgetsBodyMetadata
    from ..models.post_api_gateway_v1_budgets_body_scope_type_0 import PostApiGatewayV1BudgetsBodyScopeType0
    from ..models.post_api_gateway_v1_budgets_body_scope_type_1 import PostApiGatewayV1BudgetsBodyScopeType1
    from ..models.post_api_gateway_v1_budgets_body_scope_type_2 import PostApiGatewayV1BudgetsBodyScopeType2
    from ..models.post_api_gateway_v1_budgets_body_scope_type_3 import PostApiGatewayV1BudgetsBodyScopeType3
    from ..models.post_api_gateway_v1_budgets_body_scope_type_4 import PostApiGatewayV1BudgetsBodyScopeType4
    from ..models.post_api_gateway_v1_budgets_body_scope_type_5 import PostApiGatewayV1BudgetsBodyScopeType5
    from ..models.post_api_gateway_v1_budgets_body_scope_type_6 import PostApiGatewayV1BudgetsBodyScopeType6


T = TypeVar("T", bound="PostApiGatewayV1BudgetsBody")


@_attrs_define
class PostApiGatewayV1BudgetsBody:
    """
    Attributes:
        scope (PostApiGatewayV1BudgetsBodyScopeType0 | PostApiGatewayV1BudgetsBodyScopeType1 |
            PostApiGatewayV1BudgetsBodyScopeType2 | PostApiGatewayV1BudgetsBodyScopeType3 |
            PostApiGatewayV1BudgetsBodyScopeType4 | PostApiGatewayV1BudgetsBodyScopeType5 |
            PostApiGatewayV1BudgetsBodyScopeType6):
        name (str):
        window (PostApiGatewayV1BudgetsBodyWindow):
        limit_usd (float | str):
        description (str | Unset):
        on_breach (PostApiGatewayV1BudgetsBodyOnBreach | Unset):
        timezone (None | str | Unset):
        provider_key (None | str | Unset):
        external_id (None | str | Unset):
        metadata (PostApiGatewayV1BudgetsBodyMetadata | Unset):
        cycle_anchor_at (datetime.datetime | Unset): Phases the budget's cycle off this instant instead of the calendar,
            so a `month` budget anchored 2026-01-17T09:00:00Z starts a fresh period every 17th at 09:00 UTC. Omit for
            calendar alignment, which is the default and unchanged behaviour. A month cycle anchored past the 28th clamps
            into shorter months and springs back: anchored on the 31st gives Feb 28, then Mar 31. Immutable after create,
            since moving it would redraw periods the budget has already reported and enforced on. Rejected with
            `gateway_budget_cycle_anchor_invalid` on `total` and `manual`, which do not cycle.
        allow_unreachable (bool | Unset): Keeps a `team`, `project` or `group` budget that no active key can produce
            traffic for, which is otherwise refused with `gateway_budget_scope_unreachable`. Send it to provision ahead of
            the keys that will use the budget. An organization with no active keys is never refused, so this is not needed
            during first setup.
    """

    scope: (
        PostApiGatewayV1BudgetsBodyScopeType0
        | PostApiGatewayV1BudgetsBodyScopeType1
        | PostApiGatewayV1BudgetsBodyScopeType2
        | PostApiGatewayV1BudgetsBodyScopeType3
        | PostApiGatewayV1BudgetsBodyScopeType4
        | PostApiGatewayV1BudgetsBodyScopeType5
        | PostApiGatewayV1BudgetsBodyScopeType6
    )
    name: str
    window: PostApiGatewayV1BudgetsBodyWindow
    limit_usd: float | str
    description: str | Unset = UNSET
    on_breach: PostApiGatewayV1BudgetsBodyOnBreach | Unset = UNSET
    timezone: None | str | Unset = UNSET
    provider_key: None | str | Unset = UNSET
    external_id: None | str | Unset = UNSET
    metadata: PostApiGatewayV1BudgetsBodyMetadata | Unset = UNSET
    cycle_anchor_at: datetime.datetime | Unset = UNSET
    allow_unreachable: bool | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_api_gateway_v1_budgets_body_scope_type_0 import PostApiGatewayV1BudgetsBodyScopeType0
        from ..models.post_api_gateway_v1_budgets_body_scope_type_1 import PostApiGatewayV1BudgetsBodyScopeType1
        from ..models.post_api_gateway_v1_budgets_body_scope_type_2 import PostApiGatewayV1BudgetsBodyScopeType2
        from ..models.post_api_gateway_v1_budgets_body_scope_type_3 import PostApiGatewayV1BudgetsBodyScopeType3
        from ..models.post_api_gateway_v1_budgets_body_scope_type_4 import PostApiGatewayV1BudgetsBodyScopeType4
        from ..models.post_api_gateway_v1_budgets_body_scope_type_5 import PostApiGatewayV1BudgetsBodyScopeType5

        scope: dict[str, Any]
        if isinstance(self.scope, PostApiGatewayV1BudgetsBodyScopeType0):
            scope = self.scope.to_dict()
        elif isinstance(self.scope, PostApiGatewayV1BudgetsBodyScopeType1):
            scope = self.scope.to_dict()
        elif isinstance(self.scope, PostApiGatewayV1BudgetsBodyScopeType2):
            scope = self.scope.to_dict()
        elif isinstance(self.scope, PostApiGatewayV1BudgetsBodyScopeType3):
            scope = self.scope.to_dict()
        elif isinstance(self.scope, PostApiGatewayV1BudgetsBodyScopeType4):
            scope = self.scope.to_dict()
        elif isinstance(self.scope, PostApiGatewayV1BudgetsBodyScopeType5):
            scope = self.scope.to_dict()
        else:
            scope = self.scope.to_dict()

        name = self.name

        window = self.window.value

        limit_usd: float | str
        limit_usd = self.limit_usd

        description = self.description

        on_breach: str | Unset = UNSET
        if not isinstance(self.on_breach, Unset):
            on_breach = self.on_breach.value

        timezone: None | str | Unset
        if isinstance(self.timezone, Unset):
            timezone = UNSET
        else:
            timezone = self.timezone

        provider_key: None | str | Unset
        if isinstance(self.provider_key, Unset):
            provider_key = UNSET
        else:
            provider_key = self.provider_key

        external_id: None | str | Unset
        if isinstance(self.external_id, Unset):
            external_id = UNSET
        else:
            external_id = self.external_id

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        cycle_anchor_at: str | Unset = UNSET
        if not isinstance(self.cycle_anchor_at, Unset):
            cycle_anchor_at = self.cycle_anchor_at.isoformat()

        allow_unreachable = self.allow_unreachable

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "scope": scope,
                "name": name,
                "window": window,
                "limit_usd": limit_usd,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description
        if on_breach is not UNSET:
            field_dict["on_breach"] = on_breach
        if timezone is not UNSET:
            field_dict["timezone"] = timezone
        if provider_key is not UNSET:
            field_dict["provider_key"] = provider_key
        if external_id is not UNSET:
            field_dict["external_id"] = external_id
        if metadata is not UNSET:
            field_dict["metadata"] = metadata
        if cycle_anchor_at is not UNSET:
            field_dict["cycle_anchor_at"] = cycle_anchor_at
        if allow_unreachable is not UNSET:
            field_dict["allow_unreachable"] = allow_unreachable

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_gateway_v1_budgets_body_metadata import PostApiGatewayV1BudgetsBodyMetadata
        from ..models.post_api_gateway_v1_budgets_body_scope_type_0 import PostApiGatewayV1BudgetsBodyScopeType0
        from ..models.post_api_gateway_v1_budgets_body_scope_type_1 import PostApiGatewayV1BudgetsBodyScopeType1
        from ..models.post_api_gateway_v1_budgets_body_scope_type_2 import PostApiGatewayV1BudgetsBodyScopeType2
        from ..models.post_api_gateway_v1_budgets_body_scope_type_3 import PostApiGatewayV1BudgetsBodyScopeType3
        from ..models.post_api_gateway_v1_budgets_body_scope_type_4 import PostApiGatewayV1BudgetsBodyScopeType4
        from ..models.post_api_gateway_v1_budgets_body_scope_type_5 import PostApiGatewayV1BudgetsBodyScopeType5
        from ..models.post_api_gateway_v1_budgets_body_scope_type_6 import PostApiGatewayV1BudgetsBodyScopeType6

        d = dict(src_dict)

        def _parse_scope(
            data: object,
        ) -> (
            PostApiGatewayV1BudgetsBodyScopeType0
            | PostApiGatewayV1BudgetsBodyScopeType1
            | PostApiGatewayV1BudgetsBodyScopeType2
            | PostApiGatewayV1BudgetsBodyScopeType3
            | PostApiGatewayV1BudgetsBodyScopeType4
            | PostApiGatewayV1BudgetsBodyScopeType5
            | PostApiGatewayV1BudgetsBodyScopeType6
        ):
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                scope_type_0 = PostApiGatewayV1BudgetsBodyScopeType0.from_dict(data)

                return scope_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                scope_type_1 = PostApiGatewayV1BudgetsBodyScopeType1.from_dict(data)

                return scope_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                scope_type_2 = PostApiGatewayV1BudgetsBodyScopeType2.from_dict(data)

                return scope_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                scope_type_3 = PostApiGatewayV1BudgetsBodyScopeType3.from_dict(data)

                return scope_type_3
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                scope_type_4 = PostApiGatewayV1BudgetsBodyScopeType4.from_dict(data)

                return scope_type_4
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                scope_type_5 = PostApiGatewayV1BudgetsBodyScopeType5.from_dict(data)

                return scope_type_5
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            scope_type_6 = PostApiGatewayV1BudgetsBodyScopeType6.from_dict(data)

            return scope_type_6

        scope = _parse_scope(d.pop("scope"))

        name = d.pop("name")

        window = PostApiGatewayV1BudgetsBodyWindow(d.pop("window"))

        def _parse_limit_usd(data: object) -> float | str:
            return cast(float | str, data)

        limit_usd = _parse_limit_usd(d.pop("limit_usd"))

        description = d.pop("description", UNSET)

        _on_breach = d.pop("on_breach", UNSET)
        on_breach: PostApiGatewayV1BudgetsBodyOnBreach | Unset
        if isinstance(_on_breach, Unset):
            on_breach = UNSET
        else:
            on_breach = PostApiGatewayV1BudgetsBodyOnBreach(_on_breach)

        def _parse_timezone(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        timezone = _parse_timezone(d.pop("timezone", UNSET))

        def _parse_provider_key(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        provider_key = _parse_provider_key(d.pop("provider_key", UNSET))

        def _parse_external_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        external_id = _parse_external_id(d.pop("external_id", UNSET))

        _metadata = d.pop("metadata", UNSET)
        metadata: PostApiGatewayV1BudgetsBodyMetadata | Unset
        if isinstance(_metadata, Unset):
            metadata = UNSET
        else:
            metadata = PostApiGatewayV1BudgetsBodyMetadata.from_dict(_metadata)

        _cycle_anchor_at = d.pop("cycle_anchor_at", UNSET)
        cycle_anchor_at: datetime.datetime | Unset
        if isinstance(_cycle_anchor_at, Unset):
            cycle_anchor_at = UNSET
        else:
            cycle_anchor_at = isoparse(_cycle_anchor_at)

        allow_unreachable = d.pop("allow_unreachable", UNSET)

        post_api_gateway_v1_budgets_body = cls(
            scope=scope,
            name=name,
            window=window,
            limit_usd=limit_usd,
            description=description,
            on_breach=on_breach,
            timezone=timezone,
            provider_key=provider_key,
            external_id=external_id,
            metadata=metadata,
            cycle_anchor_at=cycle_anchor_at,
            allow_unreachable=allow_unreachable,
        )

        post_api_gateway_v1_budgets_body.additional_properties = d
        return post_api_gateway_v1_budgets_body

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
