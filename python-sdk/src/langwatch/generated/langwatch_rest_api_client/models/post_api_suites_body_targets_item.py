from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_suites_body_targets_item_type import PostApiSuitesBodyTargetsItemType

T = TypeVar("T", bound="PostApiSuitesBodyTargetsItem")


@_attrs_define
class PostApiSuitesBodyTargetsItem:
    """
    Attributes:
        type_ (PostApiSuitesBodyTargetsItemType):
        reference_id (str):
    """

    type_: PostApiSuitesBodyTargetsItemType
    reference_id: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        reference_id = self.reference_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "referenceId": reference_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = PostApiSuitesBodyTargetsItemType(d.pop("type"))

        reference_id = d.pop("referenceId")

        post_api_suites_body_targets_item = cls(
            type_=type_,
            reference_id=reference_id,
        )

        post_api_suites_body_targets_item.additional_properties = d
        return post_api_suites_body_targets_item

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
