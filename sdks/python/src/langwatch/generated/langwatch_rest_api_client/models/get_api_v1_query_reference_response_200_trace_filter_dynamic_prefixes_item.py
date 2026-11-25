from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

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

    def to_dict(self) -> dict[str, Any]:
        prefix = self.prefix

        label = self.label

        description = self.description

        aliases = self.aliases

        field_dict: dict[str, Any] = {}

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

        return get_api_v1_query_reference_response_200_trace_filter_dynamic_prefixes_item
