from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.langy_local_start_wait_body_questions_item_options_item import (
        LangyLocalStartWaitBodyQuestionsItemOptionsItem,
    )


T = TypeVar("T", bound="LangyLocalStartWaitBodyQuestionsItem")


@_attrs_define
class LangyLocalStartWaitBodyQuestionsItem:
    """
    Attributes:
        question (str):
        options (list[LangyLocalStartWaitBodyQuestionsItemOptionsItem]):
        header (str | Unset):
        multiple (bool | Unset):
        allow_other (bool | Unset):
        bare (bool | Unset):
    """

    question: str
    options: list[LangyLocalStartWaitBodyQuestionsItemOptionsItem]
    header: str | Unset = UNSET
    multiple: bool | Unset = UNSET
    allow_other: bool | Unset = UNSET
    bare: bool | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        question = self.question

        options = []
        for options_item_data in self.options:
            options_item = options_item_data.to_dict()
            options.append(options_item)

        header = self.header

        multiple = self.multiple

        allow_other = self.allow_other

        bare = self.bare

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "question": question,
                "options": options,
            }
        )
        if header is not UNSET:
            field_dict["header"] = header
        if multiple is not UNSET:
            field_dict["multiple"] = multiple
        if allow_other is not UNSET:
            field_dict["allowOther"] = allow_other
        if bare is not UNSET:
            field_dict["bare"] = bare

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.langy_local_start_wait_body_questions_item_options_item import (
            LangyLocalStartWaitBodyQuestionsItemOptionsItem,
        )

        d = dict(src_dict)
        question = d.pop("question")

        options = []
        _options = d.pop("options")
        for options_item_data in _options:
            options_item = LangyLocalStartWaitBodyQuestionsItemOptionsItem.from_dict(options_item_data)

            options.append(options_item)

        header = d.pop("header", UNSET)

        multiple = d.pop("multiple", UNSET)

        allow_other = d.pop("allowOther", UNSET)

        bare = d.pop("bare", UNSET)

        langy_local_start_wait_body_questions_item = cls(
            question=question,
            options=options,
            header=header,
            multiple=multiple,
            allow_other=allow_other,
            bare=bare,
        )

        langy_local_start_wait_body_questions_item.additional_properties = d
        return langy_local_start_wait_body_questions_item

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
