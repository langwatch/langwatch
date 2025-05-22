from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_prompts_response_401_error import PostApiPromptsResponse401Error

T = TypeVar("T", bound="PostApiPromptsResponse401")


@_attrs_define
class PostApiPromptsResponse401:
    """
    Attributes:
        error (PostApiPromptsResponse401Error):
    """

    error: PostApiPromptsResponse401Error
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
        error = PostApiPromptsResponse401Error(d.pop("error"))

        post_api_prompts_response_401 = cls(
            error=error,
        )

        post_api_prompts_response_401.additional_properties = d
        return post_api_prompts_response_401

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
