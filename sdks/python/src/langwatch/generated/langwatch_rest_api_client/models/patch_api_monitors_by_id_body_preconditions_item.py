from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PatchApiMonitorsByIdBodyPreconditionsItem")


@_attrs_define
class PatchApiMonitorsByIdBodyPreconditionsItem:
    """
    Attributes:
        field (str):
        rule (str):
        value (str):
        key (str | Unset):
        subkey (str | Unset):
    """

    field: str
    rule: str
    value: str
    key: str | Unset = UNSET
    subkey: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        field = self.field

        rule = self.rule

        value = self.value

        key = self.key

        subkey = self.subkey

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "field": field,
                "rule": rule,
                "value": value,
            }
        )
        if key is not UNSET:
            field_dict["key"] = key
        if subkey is not UNSET:
            field_dict["subkey"] = subkey

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        field = d.pop("field")

        rule = d.pop("rule")

        value = d.pop("value")

        key = d.pop("key", UNSET)

        subkey = d.pop("subkey", UNSET)

        patch_api_monitors_by_id_body_preconditions_item = cls(
            field=field,
            rule=rule,
            value=value,
            key=key,
            subkey=subkey,
        )

        patch_api_monitors_by_id_body_preconditions_item.additional_properties = d
        return patch_api_monitors_by_id_body_preconditions_item

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
