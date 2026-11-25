from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.approve_langy_control_request_response_200_conversation import (
        ApproveLangyControlRequestResponse200Conversation,
    )


T = TypeVar("T", bound="ApproveLangyControlRequestResponse200")


@_attrs_define
class ApproveLangyControlRequestResponse200:
    """
    Attributes:
        session_key (str):
        endpoint (str):
        conversation (ApproveLangyControlRequestResponse200Conversation):
    """

    session_key: str
    endpoint: str
    conversation: ApproveLangyControlRequestResponse200Conversation

    def to_dict(self) -> dict[str, Any]:
        session_key = self.session_key

        endpoint = self.endpoint

        conversation = self.conversation.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "sessionKey": session_key,
                "endpoint": endpoint,
                "conversation": conversation,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.approve_langy_control_request_response_200_conversation import (
            ApproveLangyControlRequestResponse200Conversation,
        )

        d = dict(src_dict)
        session_key = d.pop("sessionKey")

        endpoint = d.pop("endpoint")

        conversation = ApproveLangyControlRequestResponse200Conversation.from_dict(d.pop("conversation"))

        approve_langy_control_request_response_200 = cls(
            session_key=session_key,
            endpoint=endpoint,
            conversation=conversation,
        )

        return approve_langy_control_request_response_200
