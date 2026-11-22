from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.langy_local_read_wait_response_200_state import LangyLocalReadWaitResponse200State
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.langy_local_read_wait_response_200_answers_item import LangyLocalReadWaitResponse200AnswersItem


T = TypeVar("T", bound="LangyLocalReadWaitResponse200")


@_attrs_define
class LangyLocalReadWaitResponse200:
    """
    Attributes:
        wait_id (str):
        state (LangyLocalReadWaitResponse200State):
        answers (list[LangyLocalReadWaitResponse200AnswersItem] | Unset):
    """

    wait_id: str
    state: LangyLocalReadWaitResponse200State
    answers: list[LangyLocalReadWaitResponse200AnswersItem] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        wait_id = self.wait_id

        state = self.state.value

        answers: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.answers, Unset):
            answers = []
            for answers_item_data in self.answers:
                answers_item = answers_item_data.to_dict()
                answers.append(answers_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "waitId": wait_id,
                "state": state,
            }
        )
        if answers is not UNSET:
            field_dict["answers"] = answers

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.langy_local_read_wait_response_200_answers_item import LangyLocalReadWaitResponse200AnswersItem

        d = dict(src_dict)
        wait_id = d.pop("waitId")

        state = LangyLocalReadWaitResponse200State(d.pop("state"))

        _answers = d.pop("answers", UNSET)
        answers: list[LangyLocalReadWaitResponse200AnswersItem] | Unset = UNSET
        if _answers is not UNSET:
            answers = []
            for answers_item_data in _answers:
                answers_item = LangyLocalReadWaitResponse200AnswersItem.from_dict(answers_item_data)

                answers.append(answers_item)

        langy_local_read_wait_response_200 = cls(
            wait_id=wait_id,
            state=state,
            answers=answers,
        )

        return langy_local_read_wait_response_200
