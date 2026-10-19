from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.create_test_suite_response_201_fields_item_type import CreateTestSuiteResponse201FieldsItemType

T = TypeVar("T", bound="CreateTestSuiteResponse201FieldsItem")


@_attrs_define
class CreateTestSuiteResponse201FieldsItem:
    """One field the test suite declares beyond situation and criteria. Every scenario filed in the suite carries a value
    for it.

        Attributes:
            identifier (str): The field name, as scenarios and evaluator mappings address it. Lowercase letters, digits and
                underscores, starting with a letter.
            type_ (CreateTestSuiteResponse201FieldsItemType): The value type every scenario carries for this field.
    """

    identifier: str
    type_: CreateTestSuiteResponse201FieldsItemType

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

        type_ = CreateTestSuiteResponse201FieldsItemType(d.pop("type"))

        create_test_suite_response_201_fields_item = cls(
            identifier=identifier,
            type_=type_,
        )

        return create_test_suite_response_201_fields_item
