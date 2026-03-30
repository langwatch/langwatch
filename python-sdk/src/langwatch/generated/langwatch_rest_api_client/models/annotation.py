from collections.abc import Mapping
from typing import Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="Annotation")


@_attrs_define
class Annotation:
    """
    Attributes:
        id (Union[Unset, str]): The ID of the annotation
        project_id (Union[Unset, str]): The ID of the project
        trace_id (Union[Unset, str]): The ID of the trace
        comment (Union[Unset, str]): The comment of the annotation
        is_thumbs_up (Union[Unset, bool]): The thumbs up status of the annotation
        user_id (Union[Unset, str]): The ID of the user
        created_at (Union[Unset, str]): The created at of the annotation
        updated_at (Union[Unset, str]): The updated at of the annotation
        email (Union[Unset, str]): The email of the user
    """

    id: Union[Unset, str] = UNSET
    project_id: Union[Unset, str] = UNSET
    trace_id: Union[Unset, str] = UNSET
    comment: Union[Unset, str] = UNSET
    is_thumbs_up: Union[Unset, bool] = UNSET
    user_id: Union[Unset, str] = UNSET
    created_at: Union[Unset, str] = UNSET
    updated_at: Union[Unset, str] = UNSET
    email: Union[Unset, str] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        project_id = self.project_id

        trace_id = self.trace_id

        comment = self.comment

        is_thumbs_up = self.is_thumbs_up

        user_id = self.user_id

        created_at = self.created_at

        updated_at = self.updated_at

        email = self.email

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if id is not UNSET:
            field_dict["id"] = id
        if project_id is not UNSET:
            field_dict["projectId"] = project_id
        if trace_id is not UNSET:
            field_dict["traceId"] = trace_id
        if comment is not UNSET:
            field_dict["comment"] = comment
        if is_thumbs_up is not UNSET:
            field_dict["isThumbsUp"] = is_thumbs_up
        if user_id is not UNSET:
            field_dict["userId"] = user_id
        if created_at is not UNSET:
            field_dict["createdAt"] = created_at
        if updated_at is not UNSET:
            field_dict["updatedAt"] = updated_at
        if email is not UNSET:
            field_dict["email"] = email

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id", UNSET)

        project_id = d.pop("projectId", UNSET)

        trace_id = d.pop("traceId", UNSET)

        comment = d.pop("comment", UNSET)

        is_thumbs_up = d.pop("isThumbsUp", UNSET)

        user_id = d.pop("userId", UNSET)

        created_at = d.pop("createdAt", UNSET)

        updated_at = d.pop("updatedAt", UNSET)

        email = d.pop("email", UNSET)

        annotation = cls(
            id=id,
            project_id=project_id,
            trace_id=trace_id,
            comment=comment,
            is_thumbs_up=is_thumbs_up,
            user_id=user_id,
            created_at=created_at,
            updated_at=updated_at,
            email=email,
        )

        annotation.additional_properties = d
        return annotation

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
