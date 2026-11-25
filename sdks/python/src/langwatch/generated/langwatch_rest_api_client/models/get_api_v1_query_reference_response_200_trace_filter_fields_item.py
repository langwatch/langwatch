from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.get_api_v1_query_reference_response_200_trace_filter_fields_item_value_type import (
    GetApiV1QueryReferenceResponse200TraceFilterFieldsItemValueType,
)

T = TypeVar("T", bound="GetApiV1QueryReferenceResponse200TraceFilterFieldsItem")


@_attrs_define
class GetApiV1QueryReferenceResponse200TraceFilterFieldsItem:
    """
    Attributes:
        name (str):
        label (str):
        value_type (GetApiV1QueryReferenceResponse200TraceFilterFieldsItemValueType):
        group (None | str):
        facetable (bool):
        known_values (list[str]):
    """

    name: str
    label: str
    value_type: GetApiV1QueryReferenceResponse200TraceFilterFieldsItemValueType
    group: None | str
    facetable: bool
    known_values: list[str]

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        label = self.label

        value_type = self.value_type.value

        group: None | str
        group = self.group

        facetable = self.facetable

        known_values = self.known_values

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "label": label,
                "valueType": value_type,
                "group": group,
                "facetable": facetable,
                "knownValues": known_values,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        label = d.pop("label")

        value_type = GetApiV1QueryReferenceResponse200TraceFilterFieldsItemValueType(d.pop("valueType"))

        def _parse_group(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        group = _parse_group(d.pop("group"))

        facetable = d.pop("facetable")

        known_values = cast(list[str], d.pop("knownValues"))

        get_api_v1_query_reference_response_200_trace_filter_fields_item = cls(
            name=name,
            label=label,
            value_type=value_type,
            group=group,
            facetable=facetable,
            known_values=known_values,
        )

        return get_api_v1_query_reference_response_200_trace_filter_fields_item
