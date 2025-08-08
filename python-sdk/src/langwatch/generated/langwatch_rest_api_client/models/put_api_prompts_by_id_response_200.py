from collections.abc import Mapping
from typing import Any, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.put_api_prompts_by_id_response_200_scope import PutApiPromptsByIdResponse200Scope

T = TypeVar("T", bound="PutApiPromptsByIdResponse200")


@_attrs_define
class PutApiPromptsByIdResponse200:
    """
    Attributes:
        id (str):
        updated_at (str):
        handle (Union[None, str]):
        scope (PutApiPromptsByIdResponse200Scope):
    """

    id: str
    updated_at: str
    handle: Union[None, str]
    scope: PutApiPromptsByIdResponse200Scope
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        updated_at = self.updated_at

        handle: Union[None, str]
        handle = self.handle

        scope = self.scope.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "updatedAt": updated_at,
                "handle": handle,
                "scope": scope,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        updated_at = d.pop("updatedAt")

        def _parse_handle(data: object) -> Union[None, str]:
            if data is None:
                return data
            return cast(Union[None, str], data)

        handle = _parse_handle(d.pop("handle"))

        scope = PutApiPromptsByIdResponse200Scope(d.pop("scope"))

        put_api_prompts_by_id_response_200 = cls(
            id=id,
            updated_at=updated_at,
            handle=handle,
            scope=scope,
        )

        put_api_prompts_by_id_response_200.additional_properties = d
        return put_api_prompts_by_id_response_200

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
