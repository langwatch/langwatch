from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.create_agent_body_type_5_config_type_1_call_direction import CreateAgentBodyType5ConfigType1CallDirection
from ..types import UNSET, Unset

T = TypeVar("T", bound="CreateAgentBodyType5ConfigType1")


@_attrs_define
class CreateAgentBodyType5ConfigType1:
    """
    Attributes:
        transport (Literal['phone']):
        phone_number (str):
        call_direction (CreateAgentBodyType5ConfigType1CallDirection | Unset):  Default:
            CreateAgentBodyType5ConfigType1CallDirection.OUTBOUND.
    """

    transport: Literal["phone"]
    phone_number: str
    call_direction: CreateAgentBodyType5ConfigType1CallDirection | Unset = (
        CreateAgentBodyType5ConfigType1CallDirection.OUTBOUND
    )
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        transport = self.transport

        phone_number = self.phone_number

        call_direction: str | Unset = UNSET
        if not isinstance(self.call_direction, Unset):
            call_direction = self.call_direction.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "transport": transport,
                "phoneNumber": phone_number,
            }
        )
        if call_direction is not UNSET:
            field_dict["callDirection"] = call_direction

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        transport = cast(Literal["phone"], d.pop("transport"))
        if transport != "phone":
            raise ValueError(f"transport must match const 'phone', got '{transport}'")

        phone_number = d.pop("phoneNumber")

        _call_direction = d.pop("callDirection", UNSET)
        call_direction: CreateAgentBodyType5ConfigType1CallDirection | Unset
        if isinstance(_call_direction, Unset):
            call_direction = UNSET
        else:
            call_direction = CreateAgentBodyType5ConfigType1CallDirection(_call_direction)

        create_agent_body_type_5_config_type_1 = cls(
            transport=transport,
            phone_number=phone_number,
            call_direction=call_direction,
        )

        create_agent_body_type_5_config_type_1.additional_properties = d
        return create_agent_body_type_5_config_type_1

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
