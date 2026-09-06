from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.call_connected_agent_response_200_instance import CallConnectedAgentResponse200Instance
    from ..models.call_connected_agent_response_200_output_type_1 import CallConnectedAgentResponse200OutputType1
    from ..models.call_connected_agent_response_200_output_type_2_item import (
        CallConnectedAgentResponse200OutputType2Item,
    )


T = TypeVar("T", bound="CallConnectedAgentResponse200")


@_attrs_define
class CallConnectedAgentResponse200:
    """
    Attributes:
        output (CallConnectedAgentResponse200OutputType1 | list[CallConnectedAgentResponse200OutputType2Item] | str):
            What the function answered: text, one message, or a list of messages.
        instance (CallConnectedAgentResponse200Instance):
        duration_ms (float):
        session (Any | Unset): The agent's per-conversation memory, to send on the next turn.
    """

    output: CallConnectedAgentResponse200OutputType1 | list[CallConnectedAgentResponse200OutputType2Item] | str
    instance: CallConnectedAgentResponse200Instance
    duration_ms: float
    session: Any | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.call_connected_agent_response_200_output_type_1 import CallConnectedAgentResponse200OutputType1

        output: dict[str, Any] | list[dict[str, Any]] | str
        if isinstance(self.output, CallConnectedAgentResponse200OutputType1):
            output = self.output.to_dict()
        elif isinstance(self.output, list):
            output = []
            for output_type_2_item_data in self.output:
                output_type_2_item = output_type_2_item_data.to_dict()
                output.append(output_type_2_item)

        else:
            output = self.output

        instance = self.instance.to_dict()

        duration_ms = self.duration_ms

        session = self.session

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "output": output,
                "instance": instance,
                "durationMs": duration_ms,
            }
        )
        if session is not UNSET:
            field_dict["session"] = session

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.call_connected_agent_response_200_instance import CallConnectedAgentResponse200Instance
        from ..models.call_connected_agent_response_200_output_type_1 import CallConnectedAgentResponse200OutputType1
        from ..models.call_connected_agent_response_200_output_type_2_item import (
            CallConnectedAgentResponse200OutputType2Item,
        )

        d = dict(src_dict)

        def _parse_output(
            data: object,
        ) -> CallConnectedAgentResponse200OutputType1 | list[CallConnectedAgentResponse200OutputType2Item] | str:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                output_type_1 = CallConnectedAgentResponse200OutputType1.from_dict(data)

                return output_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, list):
                    raise TypeError()
                output_type_2 = []
                _output_type_2 = data
                for output_type_2_item_data in _output_type_2:
                    output_type_2_item = CallConnectedAgentResponse200OutputType2Item.from_dict(output_type_2_item_data)

                    output_type_2.append(output_type_2_item)

                return output_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                CallConnectedAgentResponse200OutputType1 | list[CallConnectedAgentResponse200OutputType2Item] | str,
                data,
            )

        output = _parse_output(d.pop("output"))

        instance = CallConnectedAgentResponse200Instance.from_dict(d.pop("instance"))

        duration_ms = d.pop("durationMs")

        session = d.pop("session", UNSET)

        call_connected_agent_response_200 = cls(
            output=output,
            instance=instance,
            duration_ms=duration_ms,
            session=session,
        )

        call_connected_agent_response_200.additional_properties = d
        return call_connected_agent_response_200

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
