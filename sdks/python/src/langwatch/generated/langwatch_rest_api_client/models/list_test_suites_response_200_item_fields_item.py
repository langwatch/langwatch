from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.list_test_suites_response_200_item_fields_item_type import ListTestSuitesResponse200ItemFieldsItemType

T = TypeVar("T", bound="ListTestSuitesResponse200ItemFieldsItem")


@_attrs_define
class ListTestSuitesResponse200ItemFieldsItem:
    """One field the test suite declares beyond situation and criteria. Every scenario filed in the suite carries a value
    for it.

        Attributes:
            identifier (str): The field name, as scenarios and evaluator mappings address it. Lowercase letters, digits and
                underscores, starting with a letter.
            type_ (ListTestSuitesResponse200ItemFieldsItemType): The value type every scenario carries for this field.
    """

    identifier: str
    type_: ListTestSuitesResponse200ItemFieldsItemType

    def to_dict(self) -> dict[str, Any]:
        identifier = self.identifier

        type_ = self.type_.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "identifier": identifier,
                "type": type_,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        identifier = d.pop("identifier")

        type_ = ListTestSuitesResponse200ItemFieldsItemType(d.pop("type"))

        list_test_suites_response_200_item_fields_item = cls(
            identifier=identifier,
            type_=type_,
        )

        return list_test_suites_response_200_item_fields_item
