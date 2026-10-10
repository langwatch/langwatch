from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
        protocol (Literal[1]):
        type_ (Literal['result']):
        call_id (str):
        output (list[PostConnectedAgentFramesBodyFramesItemType1OutputType2Item] |
            PostConnectedAgentFramesBodyFramesItemType1OutputType1 | str | Unset):
        session (Any | Unset):
        error (PostConnectedAgentFramesBodyFramesItemType1Error | Unset):
    """

    protocol: Literal[1]
    type_: Literal["result"]
    call_id: str
    output: (
        list[PostConnectedAgentFramesBodyFramesItemType1OutputType2Item]
        | PostConnectedAgentFramesBodyFramesItemType1OutputType1
        | str
        | Unset
    ) = UNSET
    session: Any | Unset = UNSET
    error: PostConnectedAgentFramesBodyFramesItemType1Error | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_connected_agent_frames_body_frames_item_type_1_output_type_1 import (
            PostConnectedAgentFramesBodyFramesItemType1OutputType1,
        )

        protocol = self.protocol

        type_ = self.type_

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
        field_dict.update(self.additional_properties)
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
        protocol = cast(Literal[1], d.pop("protocol"))
        if protocol != 1:
            raise ValueError(f"protocol must match const 1, got '{protocol}'")

        type_ = cast(Literal["result"], d.pop("type"))
        if type_ != "result":
            raise ValueError(f"type must match const 'result', got '{type_}'")

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

        post_connected_agent_frames_body_frames_item_type_1.additional_properties = d
        return post_connected_agent_frames_body_frames_item_type_1

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
