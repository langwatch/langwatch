from collections.abc import Mapping
from typing import Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PatchApiAnnotationsIdBody")


@_attrs_define
class PatchApiAnnotationsIdBody:
    """
    Attributes:
        comment (Union[Unset, str]):
        is_thumbs_up (Union[Unset, bool]):
        email (Union[Unset, str]):
    """

    comment: Union[Unset, str] = UNSET
    is_thumbs_up: Union[Unset, bool] = UNSET
    email: Union[Unset, str] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        comment = self.comment

        is_thumbs_up = self.is_thumbs_up

        email = self.email

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if comment is not UNSET:
            field_dict["comment"] = comment
        if is_thumbs_up is not UNSET:
            field_dict["isThumbsUp"] = is_thumbs_up
        if email is not UNSET:
            field_dict["email"] = email

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        comment = d.pop("comment", UNSET)

        is_thumbs_up = d.pop("isThumbsUp", UNSET)

        email = d.pop("email", UNSET)

        patch_api_annotations_id_body = cls(
            comment=comment,
            is_thumbs_up=is_thumbs_up,
            email=email,
        )

        patch_api_annotations_id_body.additional_properties = d
        return patch_api_annotations_id_body

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
