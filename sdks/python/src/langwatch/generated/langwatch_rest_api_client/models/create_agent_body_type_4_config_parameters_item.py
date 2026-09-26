from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.create_agent_body_type_4_config_parameters_item_type import CreateAgentBodyType4ConfigParametersItemType
from ..types import UNSET, Unset

T = TypeVar("T", bound="CreateAgentBodyType4ConfigParametersItem")


@_attrs_define
class CreateAgentBodyType4ConfigParametersItem:
    """
    Attributes:
        name (str):
        description (str | Unset):
        default_value (bool | float | str | Unset):
        secret (bool | Unset):
        type_ (CreateAgentBodyType4ConfigParametersItemType | Unset):
        options (list[bool | float | str] | Unset):
        required (bool | Unset):
    """

    name: str
    description: str | Unset = UNSET
    default_value: bool | float | str | Unset = UNSET
    secret: bool | Unset = UNSET
    type_: CreateAgentBodyType4ConfigParametersItemType | Unset = UNSET
    options: list[bool | float | str] | Unset = UNSET
    required: bool | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        description = self.description

        default_value: bool | float | str | Unset
        if isinstance(self.default_value, Unset):
            default_value = UNSET
        else:
            default_value = self.default_value

        secret = self.secret

        type_: str | Unset = UNSET
        if not isinstance(self.type_, Unset):
            type_ = self.type_.value

        options: list[bool | float | str] | Unset = UNSET
        if not isinstance(self.options, Unset):
            options = []
            for options_item_data in self.options:
                options_item: bool | float | str
                options_item = options_item_data
                options.append(options_item)

        required = self.required

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description
        if default_value is not UNSET:
            field_dict["defaultValue"] = default_value
        if secret is not UNSET:
            field_dict["secret"] = secret
        if type_ is not UNSET:
            field_dict["type"] = type_
        if options is not UNSET:
            field_dict["options"] = options
        if required is not UNSET:
            field_dict["required"] = required

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        description = d.pop("description", UNSET)

        def _parse_default_value(data: object) -> bool | float | str | Unset:
            if isinstance(data, Unset):
                return data
            return cast(bool | float | str | Unset, data)

        default_value = _parse_default_value(d.pop("defaultValue", UNSET))

        secret = d.pop("secret", UNSET)

        _type_ = d.pop("type", UNSET)
        type_: CreateAgentBodyType4ConfigParametersItemType | Unset
        if isinstance(_type_, Unset):
            type_ = UNSET
        else:
            type_ = CreateAgentBodyType4ConfigParametersItemType(_type_)

        _options = d.pop("options", UNSET)
        options: list[bool | float | str] | Unset = UNSET
        if _options is not UNSET:
            options = []
            for options_item_data in _options:

                def _parse_options_item(data: object) -> bool | float | str:
                    return cast(bool | float | str, data)

                options_item = _parse_options_item(options_item_data)

                options.append(options_item)

        required = d.pop("required", UNSET)

        create_agent_body_type_4_config_parameters_item = cls(
            name=name,
            description=description,
            default_value=default_value,
            secret=secret,
            type_=type_,
            options=options,
            required=required,
        )

        return create_agent_body_type_4_config_parameters_item
