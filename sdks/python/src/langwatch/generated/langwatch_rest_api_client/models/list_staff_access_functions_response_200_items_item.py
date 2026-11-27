from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.list_staff_access_functions_response_200_items_item_scope import (
    ListStaffAccessFunctionsResponse200ItemsItemScope,
)

if TYPE_CHECKING:
    from ..models.list_staff_access_functions_response_200_items_item_input_schema import (
        ListStaffAccessFunctionsResponse200ItemsItemInputSchema,
    )


T = TypeVar("T", bound="ListStaffAccessFunctionsResponse200ItemsItem")


@_attrs_define
class ListStaffAccessFunctionsResponse200ItemsItem:
    """
    Attributes:
        name (str):
        title (str):
        scope (ListStaffAccessFunctionsResponse200ItemsItemScope):
        answers (str):
        personal (bool):
        input_schema (ListStaffAccessFunctionsResponse200ItemsItemInputSchema):
    """

    name: str
    title: str
    scope: ListStaffAccessFunctionsResponse200ItemsItemScope
    answers: str
    personal: bool
    input_schema: ListStaffAccessFunctionsResponse200ItemsItemInputSchema

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        title = self.title

        scope = self.scope.value

        answers = self.answers

        personal = self.personal

        input_schema = self.input_schema.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "title": title,
                "scope": scope,
                "answers": answers,
                "personal": personal,
                "inputSchema": input_schema,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.list_staff_access_functions_response_200_items_item_input_schema import (
            ListStaffAccessFunctionsResponse200ItemsItemInputSchema,
        )

        d = dict(src_dict)
        name = d.pop("name")

        title = d.pop("title")

        scope = ListStaffAccessFunctionsResponse200ItemsItemScope(d.pop("scope"))

        answers = d.pop("answers")

        personal = d.pop("personal")

        input_schema = ListStaffAccessFunctionsResponse200ItemsItemInputSchema.from_dict(d.pop("inputSchema"))

        list_staff_access_functions_response_200_items_item = cls(
            name=name,
            title=title,
            scope=scope,
            answers=answers,
            personal=personal,
            input_schema=input_schema,
        )

        return list_staff_access_functions_response_200_items_item
