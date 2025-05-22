from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_api_prompts_by_id_response_400_error import GetApiPromptsByIdResponse400Error

T = TypeVar("T", bound="GetApiPromptsByIdResponse400")


@_attrs_define
class GetApiPromptsByIdResponse400:
    """
    Attributes:
        error (GetApiPromptsByIdResponse400Error):
    """

    error: GetApiPromptsByIdResponse400Error
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        error = self.error.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "error": error,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        error = GetApiPromptsByIdResponse400Error(d.pop("error"))

        get_api_prompts_by_id_response_400 = cls(
            error=error,
        )

        get_api_prompts_by_id_response_400.additional_properties = d
        return get_api_prompts_by_id_response_400

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
