from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="ScimReplaceUserBodyUrnietfparamsscimschemasextensionenterprise20User")


@_attrs_define
class ScimReplaceUserBodyUrnietfparamsscimschemasextensionenterprise20User:
    """
    Attributes:
        cost_center (None | str | Unset):
    """

    cost_center: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        cost_center: None | str | Unset
        if isinstance(self.cost_center, Unset):
            cost_center = UNSET
        else:
            cost_center = self.cost_center

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if cost_center is not UNSET:
            field_dict["costCenter"] = cost_center

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)

        def _parse_cost_center(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        cost_center = _parse_cost_center(d.pop("costCenter", UNSET))

        scim_replace_user_body_urnietfparamsscimschemasextensionenterprise_20_user = cls(
            cost_center=cost_center,
        )

        scim_replace_user_body_urnietfparamsscimschemasextensionenterprise_20_user.additional_properties = d
        return scim_replace_user_body_urnietfparamsscimschemasextensionenterprise_20_user

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
