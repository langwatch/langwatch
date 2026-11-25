from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PatchApiTriggersByIdBodyActionParamsType2Headers")


@_attrs_define
class PatchApiTriggersByIdBodyActionParamsType2Headers:
    """Static headers sent with every delivery. The values are credentials: they read back as the placeholder, and sending
    the placeholder back keeps the stored ones. Changing `url` means sending the values again in the same request.

    """

    additional_properties: dict[str, str] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        patch_api_triggers_by_id_body_action_params_type_2_headers = cls()

        patch_api_triggers_by_id_body_action_params_type_2_headers.additional_properties = d
        return patch_api_triggers_by_id_body_action_params_type_2_headers

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> str:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: str) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
