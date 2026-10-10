from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.ag_ui_tool_call_function import AgUiToolCallFunction


T = TypeVar("T", bound="AgUiToolCall")


@_attrs_define
class AgUiToolCall:
    """
    Attributes:
        id (str | Unset):
        type_ (Literal['function'] | Unset):
        function (AgUiToolCallFunction | Unset):
        encrypted_value (str | Unset):
    """

    id: str | Unset = UNSET
    type_: Literal["function"] | Unset = UNSET
    function: AgUiToolCallFunction | Unset = UNSET
    encrypted_value: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        type_ = self.type_

        function: dict[str, Any] | Unset = UNSET
        if not isinstance(self.function, Unset):
            function = self.function.to_dict()

        encrypted_value = self.encrypted_value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if id is not UNSET:
            field_dict["id"] = id
        if type_ is not UNSET:
            field_dict["type"] = type_
        if function is not UNSET:
            field_dict["function"] = function
        if encrypted_value is not UNSET:
            field_dict["encryptedValue"] = encrypted_value

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.ag_ui_tool_call_function import AgUiToolCallFunction

        d = dict(src_dict)
        id = d.pop("id", UNSET)

        type_ = cast(Literal["function"] | Unset, d.pop("type", UNSET))
        if type_ != "function" and not isinstance(type_, Unset):
            raise ValueError(f"type must match const 'function', got '{type_}'")

        _function = d.pop("function", UNSET)
        function: AgUiToolCallFunction | Unset
        if isinstance(_function, Unset):
            function = UNSET
        else:
            function = AgUiToolCallFunction.from_dict(_function)

        encrypted_value = d.pop("encryptedValue", UNSET)

        ag_ui_tool_call = cls(
            id=id,
            type_=type_,
            function=function,
            encrypted_value=encrypted_value,
        )

        ag_ui_tool_call.additional_properties = d
        return ag_ui_tool_call

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
