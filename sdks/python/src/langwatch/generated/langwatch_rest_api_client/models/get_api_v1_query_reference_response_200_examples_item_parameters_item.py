from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetApiV1QueryReferenceResponse200ExamplesItemParametersItem")


@_attrs_define
class GetApiV1QueryReferenceResponse200ExamplesItemParametersItem:
    """
    Attributes:
        name (str):
        type_ (str):
        description (str):
    """

    name: str
    type_: str
    description: str

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        type_ = self.type_

        description = self.description

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "type": type_,
                "description": description,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        type_ = d.pop("type")

        description = d.pop("description")

        get_api_v1_query_reference_response_200_examples_item_parameters_item = cls(
            name=name,
            type_=type_,
            description=description,
        )

        return get_api_v1_query_reference_response_200_examples_item_parameters_item
