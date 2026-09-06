from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_monitors_body_mappings_type_0_expansions_item import (
    PostApiMonitorsBodyMappingsType0ExpansionsItem,
)

if TYPE_CHECKING:
    from ..models.post_api_monitors_body_mappings_type_0_mapping import PostApiMonitorsBodyMappingsType0Mapping


T = TypeVar("T", bound="PostApiMonitorsBodyMappingsType0")


@_attrs_define
class PostApiMonitorsBodyMappingsType0:
    """
    Attributes:
        mapping (PostApiMonitorsBodyMappingsType0Mapping):
        expansions (list[PostApiMonitorsBodyMappingsType0ExpansionsItem]):
    """

    mapping: PostApiMonitorsBodyMappingsType0Mapping
    expansions: list[PostApiMonitorsBodyMappingsType0ExpansionsItem]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        mapping = self.mapping.to_dict()

        expansions = []
        for expansions_item_data in self.expansions:
            expansions_item = expansions_item_data.value
            expansions.append(expansions_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "mapping": mapping,
                "expansions": expansions,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_monitors_body_mappings_type_0_mapping import PostApiMonitorsBodyMappingsType0Mapping

        d = dict(src_dict)
        mapping = PostApiMonitorsBodyMappingsType0Mapping.from_dict(d.pop("mapping"))

        expansions = []
        _expansions = d.pop("expansions")
        for expansions_item_data in _expansions:
            expansions_item = PostApiMonitorsBodyMappingsType0ExpansionsItem(expansions_item_data)

            expansions.append(expansions_item)

        post_api_monitors_body_mappings_type_0 = cls(
            mapping=mapping,
            expansions=expansions,
        )

        post_api_monitors_body_mappings_type_0.additional_properties = d
        return post_api_monitors_body_mappings_type_0

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
