from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.update_test_suite_response_200_fields_item_type import UpdateTestSuiteResponse200FieldsItemType

T = TypeVar("T", bound="UpdateTestSuiteResponse200FieldsItem")


@_attrs_define
class UpdateTestSuiteResponse200FieldsItem:
    """One field the test suite declares beyond situation and criteria. Every scenario filed in the suite carries a value
    for it.

        Attributes:
            identifier (str): The field name, as scenarios and evaluator mappings address it. Lowercase letters, digits and
                underscores, starting with a letter.
            type_ (UpdateTestSuiteResponse200FieldsItemType): The value type every scenario carries for this field.
    """

    identifier: str
    type_: UpdateTestSuiteResponse200FieldsItemType

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

        type_ = UpdateTestSuiteResponse200FieldsItemType(d.pop("type"))

        update_test_suite_response_200_fields_item = cls(
            identifier=identifier,
            type_=type_,
        )

        return update_test_suite_response_200_fields_item
