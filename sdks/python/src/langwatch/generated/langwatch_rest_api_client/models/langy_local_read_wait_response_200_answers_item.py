from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="LangyLocalReadWaitResponse200AnswersItem")


@_attrs_define
class LangyLocalReadWaitResponse200AnswersItem:
    """
    Attributes:
        question (str):
        selected (list[str]):
        other (str | Unset):
    """

    question: str
    selected: list[str]
    other: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        question = self.question

        selected = self.selected

        other = self.other

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "question": question,
                "selected": selected,
            }
        )
        if other is not UNSET:
            field_dict["other"] = other

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        question = d.pop("question")

        selected = cast(list[str], d.pop("selected"))

        other = d.pop("other", UNSET)

        langy_local_read_wait_response_200_answers_item = cls(
            question=question,
            selected=selected,
            other=other,
        )

        return langy_local_read_wait_response_200_answers_item
