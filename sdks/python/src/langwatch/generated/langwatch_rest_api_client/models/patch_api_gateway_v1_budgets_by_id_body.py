from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.patch_api_gateway_v1_budgets_by_id_body_on_breach import PatchApiGatewayV1BudgetsByIdBodyOnBreach
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.patch_api_gateway_v1_budgets_by_id_body_metadata import PatchApiGatewayV1BudgetsByIdBodyMetadata


T = TypeVar("T", bound="PatchApiGatewayV1BudgetsByIdBody")


@_attrs_define
class PatchApiGatewayV1BudgetsByIdBody:
    """
    Attributes:
        name (str | Unset):
        description (None | str | Unset):
        limit_usd (float | str | Unset):
        on_breach (PatchApiGatewayV1BudgetsByIdBodyOnBreach | Unset):
        timezone (None | str | Unset):
        external_id (None | str | Unset):
        metadata (PatchApiGatewayV1BudgetsByIdBodyMetadata | Unset):
    """

    name: str | Unset = UNSET
    description: None | str | Unset = UNSET
    limit_usd: float | str | Unset = UNSET
    on_breach: PatchApiGatewayV1BudgetsByIdBodyOnBreach | Unset = UNSET
    timezone: None | str | Unset = UNSET
    external_id: None | str | Unset = UNSET
    metadata: PatchApiGatewayV1BudgetsByIdBodyMetadata | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        description: None | str | Unset
        if isinstance(self.description, Unset):
            description = UNSET
        else:
            description = self.description

        limit_usd: float | str | Unset
        if isinstance(self.limit_usd, Unset):
            limit_usd = UNSET
        else:
            limit_usd = self.limit_usd

        on_breach: str | Unset = UNSET
        if not isinstance(self.on_breach, Unset):
            on_breach = self.on_breach.value

        timezone: None | str | Unset
        if isinstance(self.timezone, Unset):
            timezone = UNSET
        else:
            timezone = self.timezone

        external_id: None | str | Unset
        if isinstance(self.external_id, Unset):
            external_id = UNSET
        else:
            external_id = self.external_id

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if name is not UNSET:
            field_dict["name"] = name
        if description is not UNSET:
            field_dict["description"] = description
        if limit_usd is not UNSET:
            field_dict["limit_usd"] = limit_usd
        if on_breach is not UNSET:
            field_dict["on_breach"] = on_breach
        if timezone is not UNSET:
            field_dict["timezone"] = timezone
        if external_id is not UNSET:
            field_dict["external_id"] = external_id
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.patch_api_gateway_v1_budgets_by_id_body_metadata import PatchApiGatewayV1BudgetsByIdBodyMetadata

        d = dict(src_dict)
        name = d.pop("name", UNSET)

        def _parse_description(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        description = _parse_description(d.pop("description", UNSET))

        def _parse_limit_usd(data: object) -> float | str | Unset:
            if isinstance(data, Unset):
                return data
            return cast(float | str | Unset, data)

        limit_usd = _parse_limit_usd(d.pop("limit_usd", UNSET))

        _on_breach = d.pop("on_breach", UNSET)
        on_breach: PatchApiGatewayV1BudgetsByIdBodyOnBreach | Unset
        if isinstance(_on_breach, Unset):
            on_breach = UNSET
        else:
            on_breach = PatchApiGatewayV1BudgetsByIdBodyOnBreach(_on_breach)

        def _parse_timezone(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        timezone = _parse_timezone(d.pop("timezone", UNSET))

        def _parse_external_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        external_id = _parse_external_id(d.pop("external_id", UNSET))

        _metadata = d.pop("metadata", UNSET)
        metadata: PatchApiGatewayV1BudgetsByIdBodyMetadata | Unset
        if isinstance(_metadata, Unset):
            metadata = UNSET
        else:
            metadata = PatchApiGatewayV1BudgetsByIdBodyMetadata.from_dict(_metadata)

        patch_api_gateway_v1_budgets_by_id_body = cls(
            name=name,
            description=description,
            limit_usd=limit_usd,
            on_breach=on_breach,
            timezone=timezone,
            external_id=external_id,
            metadata=metadata,
        )

        patch_api_gateway_v1_budgets_by_id_body.additional_properties = d
        return patch_api_gateway_v1_budgets_by_id_body

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
