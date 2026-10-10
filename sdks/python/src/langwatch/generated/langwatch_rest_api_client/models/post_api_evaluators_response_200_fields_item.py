from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiEvaluatorsResponse200FieldsItem")


@_attrs_define
class PostApiEvaluatorsResponse200FieldsItem:
    """
    Attributes:
        identifier (str):
        type_ (str):
        optional (bool | Unset):
    """

    identifier: str
    type_: str
    optional: bool | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        identifier = self.identifier

        type_ = self.type_

        optional = self.optional

        field_dict: dict[str, Any] = {}

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

        post_api_evaluators_response_200_fields_item = cls(
            identifier=identifier,
            type_=type_,
            optional=optional,
        )

        return post_api_evaluators_response_200_fields_item
