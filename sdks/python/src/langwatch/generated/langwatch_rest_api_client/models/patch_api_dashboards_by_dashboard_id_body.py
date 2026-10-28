from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PatchApiDashboardsByDashboardIdBody")


@_attrs_define
class PatchApiDashboardsByDashboardIdBody:
    """
    Attributes:
        name (str | Unset):
        description (None | str | Unset):
        excluded_origins (list[str] | None | Unset):
    """

    name: str | Unset = UNSET
    description: None | str | Unset = UNSET
    excluded_origins: list[str] | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        description: None | str | Unset
        if isinstance(self.description, Unset):
            description = UNSET
        else:
            description = self.description

        excluded_origins: list[str] | None | Unset
        if isinstance(self.excluded_origins, Unset):
            excluded_origins = UNSET
        elif isinstance(self.excluded_origins, list):
            excluded_origins = self.excluded_origins

        else:
            excluded_origins = self.excluded_origins

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if name is not UNSET:
            field_dict["name"] = name
        if description is not UNSET:
            field_dict["description"] = description
        if excluded_origins is not UNSET:
            field_dict["excludedOrigins"] = excluded_origins

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name", UNSET)

        def _parse_description(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        description = _parse_description(d.pop("description", UNSET))

        def _parse_excluded_origins(data: object) -> list[str] | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                excluded_origins_type_0 = cast(list[str], data)

                return excluded_origins_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[str] | None | Unset, data)

        excluded_origins = _parse_excluded_origins(d.pop("excludedOrigins", UNSET))

        patch_api_dashboards_by_dashboard_id_body = cls(
            name=name,
            description=description,
            excluded_origins=excluded_origins,
        )

        patch_api_dashboards_by_dashboard_id_body.additional_properties = d
        return patch_api_dashboards_by_dashboard_id_body

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
