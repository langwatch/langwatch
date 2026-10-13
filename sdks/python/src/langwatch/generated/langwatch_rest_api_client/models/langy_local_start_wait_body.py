from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.langy_local_start_wait_body_questions_item import LangyLocalStartWaitBodyQuestionsItem


T = TypeVar("T", bound="LangyLocalStartWaitBody")


@_attrs_define
class LangyLocalStartWaitBody:
    """
    Attributes:
        conversation_id (str):
        turn_id (str):
        kind (Literal['question']):
        questions (list[LangyLocalStartWaitBodyQuestionsItem]):
        tool_call_id (str | Unset):
    """

    conversation_id: str
    turn_id: str
    kind: Literal["question"]
    questions: list[LangyLocalStartWaitBodyQuestionsItem]
    tool_call_id: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        conversation_id = self.conversation_id

        turn_id = self.turn_id

        kind = self.kind

        questions = []
        for questions_item_data in self.questions:
            questions_item = questions_item_data.to_dict()
            questions.append(questions_item)

        tool_call_id = self.tool_call_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "conversationId": conversation_id,
                "turnId": turn_id,
                "kind": kind,
                "questions": questions,
            }
        )
        if tool_call_id is not UNSET:
            field_dict["toolCallId"] = tool_call_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.langy_local_start_wait_body_questions_item import LangyLocalStartWaitBodyQuestionsItem

        d = dict(src_dict)
        conversation_id = d.pop("conversationId")

        turn_id = d.pop("turnId")

        kind = cast(Literal["question"], d.pop("kind"))
        if kind != "question":
            raise ValueError(f"kind must match const 'question', got '{kind}'")

        questions = []
        _questions = d.pop("questions")
        for questions_item_data in _questions:
            questions_item = LangyLocalStartWaitBodyQuestionsItem.from_dict(questions_item_data)

            questions.append(questions_item)

        tool_call_id = d.pop("toolCallId", UNSET)

        langy_local_start_wait_body = cls(
            conversation_id=conversation_id,
            turn_id=turn_id,
            kind=kind,
            questions=questions,
            tool_call_id=tool_call_id,
        )

        langy_local_start_wait_body.additional_properties = d
        return langy_local_start_wait_body

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
