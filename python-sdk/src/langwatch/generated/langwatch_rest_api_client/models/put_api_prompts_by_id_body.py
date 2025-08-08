from collections.abc import Mapping
from typing import Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.put_api_prompts_by_id_body_scope import PutApiPromptsByIdBodyScope
from ..types import UNSET, Unset

T = TypeVar("T", bound="PutApiPromptsByIdBody")


@_attrs_define
class PutApiPromptsByIdBody:
    """
    Attributes:
        handle (Union[Unset, str]):
        scope (Union[Unset, PutApiPromptsByIdBodyScope]):
    """

    handle: Union[Unset, str] = UNSET
    scope: Union[Unset, PutApiPromptsByIdBodyScope] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        handle = self.handle

        scope: Union[Unset, str] = UNSET
        if not isinstance(self.scope, Unset):
            scope = self.scope.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if handle is not UNSET:
            field_dict["handle"] = handle
        if scope is not UNSET:
            field_dict["scope"] = scope

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        handle = d.pop("handle", UNSET)

        _scope = d.pop("scope", UNSET)
        scope: Union[Unset, PutApiPromptsByIdBodyScope]
        if isinstance(_scope, Unset):
            scope = UNSET
        else:
            scope = PutApiPromptsByIdBodyScope(_scope)

        put_api_prompts_by_id_body = cls(
            handle=handle,
            scope=scope,
        )

        put_api_prompts_by_id_body.additional_properties = d
        return put_api_prompts_by_id_body

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
