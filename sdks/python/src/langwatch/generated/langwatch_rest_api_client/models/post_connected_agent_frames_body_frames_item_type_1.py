from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.post_connected_agent_frames_body_frames_item_type_1_protocol import (
    PostConnectedAgentFramesBodyFramesItemType1Protocol,
)
from ..models.post_connected_agent_frames_body_frames_item_type_1_type import (
    PostConnectedAgentFramesBodyFramesItemType1Type,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_connected_agent_frames_body_frames_item_type_1_error import (
        PostConnectedAgentFramesBodyFramesItemType1Error,
    )
    from ..models.post_connected_agent_frames_body_frames_item_type_1_output_type_1 import (
        PostConnectedAgentFramesBodyFramesItemType1OutputType1,
    )
    from ..models.post_connected_agent_frames_body_frames_item_type_1_output_type_2_item import (
        PostConnectedAgentFramesBodyFramesItemType1OutputType2Item,
    )


T = TypeVar("T", bound="PostConnectedAgentFramesBodyFramesItemType1")


@_attrs_define
class PostConnectedAgentFramesBodyFramesItemType1:
    """
    Attributes:
        protocol (PostConnectedAgentFramesBodyFramesItemType1Protocol):
        type_ (PostConnectedAgentFramesBodyFramesItemType1Type):
        call_id (str):
        output (list[PostConnectedAgentFramesBodyFramesItemType1OutputType2Item] |
            PostConnectedAgentFramesBodyFramesItemType1OutputType1 | str | Unset):
        session (Any | Unset):
        error (PostConnectedAgentFramesBodyFramesItemType1Error | Unset):
    """

    protocol: PostConnectedAgentFramesBodyFramesItemType1Protocol
    type_: PostConnectedAgentFramesBodyFramesItemType1Type
    call_id: str
    output: (
        list[PostConnectedAgentFramesBodyFramesItemType1OutputType2Item]
        | PostConnectedAgentFramesBodyFramesItemType1OutputType1
        | str
        | Unset
    ) = UNSET
    session: Any | Unset = UNSET
    error: PostConnectedAgentFramesBodyFramesItemType1Error | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_connected_agent_frames_body_frames_item_type_1_output_type_1 import (
            PostConnectedAgentFramesBodyFramesItemType1OutputType1,
        )

        protocol = self.protocol.value

        type_ = self.type_.value

        call_id = self.call_id

        output: dict[str, Any] | list[dict[str, Any]] | str | Unset
        if isinstance(self.output, Unset):
            output = UNSET
        elif isinstance(self.output, PostConnectedAgentFramesBodyFramesItemType1OutputType1):
            output = self.output.to_dict()
        elif isinstance(self.output, list):
            output = []
            for output_type_2_item_data in self.output:
                output_type_2_item = output_type_2_item_data.to_dict()
                output.append(output_type_2_item)

        else:
            output = self.output

        session = self.session

        error: dict[str, Any] | Unset = UNSET
        if not isinstance(self.error, Unset):
            error = self.error.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "protocol": protocol,
                "type": type_,
                "callId": call_id,
            }
        )
        if output is not UNSET:
            field_dict["output"] = output
        if session is not UNSET:
            field_dict["session"] = session
        if error is not UNSET:
            field_dict["error"] = error

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_connected_agent_frames_body_frames_item_type_1_error import (
            PostConnectedAgentFramesBodyFramesItemType1Error,
        )
        from ..models.post_connected_agent_frames_body_frames_item_type_1_output_type_1 import (
            PostConnectedAgentFramesBodyFramesItemType1OutputType1,
        )
        from ..models.post_connected_agent_frames_body_frames_item_type_1_output_type_2_item import (
            PostConnectedAgentFramesBodyFramesItemType1OutputType2Item,
        )

        d = dict(src_dict)
        protocol = PostConnectedAgentFramesBodyFramesItemType1Protocol(d.pop("protocol"))

        type_ = PostConnectedAgentFramesBodyFramesItemType1Type(d.pop("type"))

        call_id = d.pop("callId")

        def _parse_output(
            data: object,
        ) -> (
            list[PostConnectedAgentFramesBodyFramesItemType1OutputType2Item]
            | PostConnectedAgentFramesBodyFramesItemType1OutputType1
            | str
            | Unset
        ):
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                output_type_1 = PostConnectedAgentFramesBodyFramesItemType1OutputType1.from_dict(data)

                return output_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, list):
                    raise TypeError()
                output_type_2 = []
                _output_type_2 = data
                for output_type_2_item_data in _output_type_2:
                    output_type_2_item = PostConnectedAgentFramesBodyFramesItemType1OutputType2Item.from_dict(
                        output_type_2_item_data
                    )

                    output_type_2.append(output_type_2_item)

                return output_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                list[PostConnectedAgentFramesBodyFramesItemType1OutputType2Item]
                | PostConnectedAgentFramesBodyFramesItemType1OutputType1
                | str
                | Unset,
                data,
            )

        output = _parse_output(d.pop("output", UNSET))

        session = d.pop("session", UNSET)

        _error = d.pop("error", UNSET)
        error: PostConnectedAgentFramesBodyFramesItemType1Error | Unset
        if isinstance(_error, Unset):
            error = UNSET
        else:
            error = PostConnectedAgentFramesBodyFramesItemType1Error.from_dict(_error)

        post_connected_agent_frames_body_frames_item_type_1 = cls(
            protocol=protocol,
            type_=type_,
            call_id=call_id,
            output=output,
            session=session,
            error=error,
        )

        return post_connected_agent_frames_body_frames_item_type_1
