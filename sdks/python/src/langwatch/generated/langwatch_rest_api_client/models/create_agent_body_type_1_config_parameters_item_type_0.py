from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="CreateAgentBodyType1ConfigParametersItemType0")


@_attrs_define
class CreateAgentBodyType1ConfigParametersItemType0:
    """
    Attributes:
        identifier (Literal['code']):
        type_ (Literal['code']):
        value (str):
        optional (bool | Unset):
        desc (str | Unset):
        prefix (str | Unset):
        hidden (bool | Unset):
    """

    identifier: Literal["code"]
    type_: Literal["code"]
    value: str
    optional: bool | Unset = UNSET
    desc: str | Unset = UNSET
    prefix: str | Unset = UNSET
    hidden: bool | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        identifier = self.identifier

        type_ = self.type_

        value = self.value

        optional = self.optional

        desc = self.desc

        prefix = self.prefix

        hidden = self.hidden

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "identifier": identifier,
                "type": type_,
                "value": value,
            }
        )
        if optional is not UNSET:
            field_dict["optional"] = optional
        if desc is not UNSET:
            field_dict["desc"] = desc
        if prefix is not UNSET:
            field_dict["prefix"] = prefix
        if hidden is not UNSET:
            field_dict["hidden"] = hidden

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        identifier = cast(Literal["code"], d.pop("identifier"))
        if identifier != "code":
            raise ValueError(f"identifier must match const 'code', got '{identifier}'")

        type_ = cast(Literal["code"], d.pop("type"))
        if type_ != "code":
            raise ValueError(f"type must match const 'code', got '{type_}'")

        value = d.pop("value")

        optional = d.pop("optional", UNSET)

        desc = d.pop("desc", UNSET)

        prefix = d.pop("prefix", UNSET)

        hidden = d.pop("hidden", UNSET)

        create_agent_body_type_1_config_parameters_item_type_0 = cls(
            identifier=identifier,
            type_=type_,
            value=value,
            optional=optional,
            desc=desc,
            prefix=prefix,
            hidden=hidden,
        )

        create_agent_body_type_1_config_parameters_item_type_0.additional_properties = d
        return create_agent_body_type_1_config_parameters_item_type_0

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
