from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.ingest_turn_result_body_status import IngestTurnResultBodyStatus
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.ingest_turn_result_body_tool_calls_item import IngestTurnResultBodyToolCallsItem


T = TypeVar("T", bound="IngestTurnResultBody")


@_attrs_define
class IngestTurnResultBody:
    """
    Attributes:
        project_id (str):
        conversation_id (str):
        status (IngestTurnResultBodyStatus):
        text (str | Unset):
        tool_calls (list[IngestTurnResultBodyToolCallsItem] | Unset):
        error_code (str | Unset):
    """

    project_id: str
    conversation_id: str
    status: IngestTurnResultBodyStatus
    text: str | Unset = UNSET
    tool_calls: list[IngestTurnResultBodyToolCallsItem] | Unset = UNSET
    error_code: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        project_id = self.project_id

        conversation_id = self.conversation_id

        status = self.status.value

        text = self.text

        tool_calls: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.tool_calls, Unset):
            tool_calls = []
            for tool_calls_item_data in self.tool_calls:
                tool_calls_item = tool_calls_item_data.to_dict()
                tool_calls.append(tool_calls_item)

        error_code = self.error_code

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "projectId": project_id,
                "conversationId": conversation_id,
                "status": status,
            }
        )
        if text is not UNSET:
            field_dict["text"] = text
        if tool_calls is not UNSET:
            field_dict["toolCalls"] = tool_calls
        if error_code is not UNSET:
            field_dict["errorCode"] = error_code

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.ingest_turn_result_body_tool_calls_item import IngestTurnResultBodyToolCallsItem

        d = dict(src_dict)
        project_id = d.pop("projectId")

        conversation_id = d.pop("conversationId")

        status = IngestTurnResultBodyStatus(d.pop("status"))

        text = d.pop("text", UNSET)

        _tool_calls = d.pop("toolCalls", UNSET)
        tool_calls: list[IngestTurnResultBodyToolCallsItem] | Unset = UNSET
        if _tool_calls is not UNSET:
            tool_calls = []
            for tool_calls_item_data in _tool_calls:
                tool_calls_item = IngestTurnResultBodyToolCallsItem.from_dict(tool_calls_item_data)

                tool_calls.append(tool_calls_item)

        error_code = d.pop("errorCode", UNSET)

        ingest_turn_result_body = cls(
            project_id=project_id,
            conversation_id=conversation_id,
            status=status,
            text=text,
            tool_calls=tool_calls,
            error_code=error_code,
        )

        ingest_turn_result_body.additional_properties = d
        return ingest_turn_result_body

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
