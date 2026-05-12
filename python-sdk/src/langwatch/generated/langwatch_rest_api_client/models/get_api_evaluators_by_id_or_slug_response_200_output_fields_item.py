from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetApiEvaluatorsByIdOrSlugResponse200OutputFieldsItem")


@_attrs_define
class GetApiEvaluatorsByIdOrSlugResponse200OutputFieldsItem:
    """
    Attributes:
        identifier (str):
        type_ (str):
        optional (bool | Unset):
    """

    identifier: str
    type_: str
    optional: bool | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        identifier = self.identifier

        type_ = self.type_

        optional = self.optional

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "identifier": identifier,
                "type": type_,
            }
        )
        if optional is not UNSET:
            field_dict["optional"] = optional

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        identifier = d.pop("identifier")

        type_ = d.pop("type")

        optional = d.pop("optional", UNSET)

        get_api_evaluators_by_id_or_slug_response_200_output_fields_item = cls(
            identifier=identifier,
            type_=type_,
            optional=optional,
        )

        get_api_evaluators_by_id_or_slug_response_200_output_fields_item.additional_properties = d
        return get_api_evaluators_by_id_or_slug_response_200_output_fields_item

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
