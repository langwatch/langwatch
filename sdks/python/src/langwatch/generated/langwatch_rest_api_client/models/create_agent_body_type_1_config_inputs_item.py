from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.create_agent_body_type_1_config_inputs_item_type import CreateAgentBodyType1ConfigInputsItemType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.create_agent_body_type_1_config_inputs_item_json_schema import (
        CreateAgentBodyType1ConfigInputsItemJsonSchema,
    )


T = TypeVar("T", bound="CreateAgentBodyType1ConfigInputsItem")


@_attrs_define
class CreateAgentBodyType1ConfigInputsItem:
    """
    Attributes:
        identifier (str):
        type_ (CreateAgentBodyType1ConfigInputsItemType):
        optional (bool | Unset):
        value (Any | Unset):
        desc (str | Unset):
        prefix (str | Unset):
        hidden (bool | Unset):
        json_schema (CreateAgentBodyType1ConfigInputsItemJsonSchema | Unset):
    """

    identifier: str
    type_: CreateAgentBodyType1ConfigInputsItemType
    optional: bool | Unset = UNSET
    value: Any | Unset = UNSET
    desc: str | Unset = UNSET
    prefix: str | Unset = UNSET
    hidden: bool | Unset = UNSET
    json_schema: CreateAgentBodyType1ConfigInputsItemJsonSchema | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        identifier = self.identifier

        type_ = self.type_.value

        optional = self.optional

        value = self.value

        desc = self.desc

        prefix = self.prefix

        hidden = self.hidden

        json_schema: dict[str, Any] | Unset = UNSET
        if not isinstance(self.json_schema, Unset):
            json_schema = self.json_schema.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "identifier": identifier,
                "type": type_,
            }
        )
        if optional is not UNSET:
            field_dict["optional"] = optional
        if value is not UNSET:
            field_dict["value"] = value
        if desc is not UNSET:
            field_dict["desc"] = desc
        if prefix is not UNSET:
            field_dict["prefix"] = prefix
        if hidden is not UNSET:
            field_dict["hidden"] = hidden
        if json_schema is not UNSET:
            field_dict["json_schema"] = json_schema

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_agent_body_type_1_config_inputs_item_json_schema import (
            CreateAgentBodyType1ConfigInputsItemJsonSchema,
        )

        d = dict(src_dict)
        identifier = d.pop("identifier")

        type_ = CreateAgentBodyType1ConfigInputsItemType(d.pop("type"))

        optional = d.pop("optional", UNSET)

        value = d.pop("value", UNSET)

        desc = d.pop("desc", UNSET)

        prefix = d.pop("prefix", UNSET)

        hidden = d.pop("hidden", UNSET)

        _json_schema = d.pop("json_schema", UNSET)
        json_schema: CreateAgentBodyType1ConfigInputsItemJsonSchema | Unset
        if isinstance(_json_schema, Unset):
            json_schema = UNSET
        else:
            json_schema = CreateAgentBodyType1ConfigInputsItemJsonSchema.from_dict(_json_schema)

        create_agent_body_type_1_config_inputs_item = cls(
            identifier=identifier,
            type_=type_,
            optional=optional,
            value=value,
            desc=desc,
            prefix=prefix,
            hidden=hidden,
            json_schema=json_schema,
        )

        create_agent_body_type_1_config_inputs_item.additional_properties = d
        return create_agent_body_type_1_config_inputs_item

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
