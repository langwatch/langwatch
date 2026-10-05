from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="GetApiV1QueryReferenceResponse200TraceFilterDynamicPrefixesItem")


@_attrs_define
class GetApiV1QueryReferenceResponse200TraceFilterDynamicPrefixesItem:
    """
    Attributes:
        prefix (str):
        label (str):
        description (str):
        aliases (list[str]):
    """

    prefix: str
    label: str
    description: str
    aliases: list[str]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        prefix = self.prefix

        label = self.label

        description = self.description

        aliases = self.aliases

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "prefix": prefix,
                "label": label,
                "description": description,
                "aliases": aliases,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        prefix = d.pop("prefix")

        label = d.pop("label")

        description = d.pop("description")

        aliases = cast(list[str], d.pop("aliases"))

        get_api_v1_query_reference_response_200_trace_filter_dynamic_prefixes_item = cls(
            prefix=prefix,
            label=label,
            description=description,
            aliases=aliases,
        )

        get_api_v1_query_reference_response_200_trace_filter_dynamic_prefixes_item.additional_properties = d
        return get_api_v1_query_reference_response_200_trace_filter_dynamic_prefixes_item

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
