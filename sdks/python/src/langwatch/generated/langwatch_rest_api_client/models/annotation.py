from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="Annotation")


@_attrs_define
class Annotation:
    """
    Attributes:
        id (str): The ID of the annotation
        project_id (str): The ID of the project
        trace_id (str): The ID of the trace
        comment (None | str): The comment of the annotation
        is_thumbs_up (bool | None): The thumbs up status of the annotation
        user_id (None | str): The ID of the user
        created_at (str): The created at of the annotation
        updated_at (str): The updated at of the annotation
        email (None | str): The email of the user
    """

    id: str
    project_id: str
    trace_id: str
    comment: None | str
    is_thumbs_up: bool | None
    user_id: None | str
    created_at: str
    updated_at: str
    email: None | str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        project_id = self.project_id

        trace_id = self.trace_id

        comment: None | str
        comment = self.comment

        is_thumbs_up: bool | None
        is_thumbs_up = self.is_thumbs_up

        user_id: None | str
        user_id = self.user_id

        created_at = self.created_at

        updated_at = self.updated_at

        email: None | str
        email = self.email

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "projectId": project_id,
                "traceId": trace_id,
                "comment": comment,
                "isThumbsUp": is_thumbs_up,
                "userId": user_id,
                "createdAt": created_at,
                "updatedAt": updated_at,
                "email": email,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        project_id = d.pop("projectId")

        trace_id = d.pop("traceId")

        def _parse_comment(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        comment = _parse_comment(d.pop("comment"))

        def _parse_is_thumbs_up(data: object) -> bool | None:
            if data is None:
                return data
            return cast(bool | None, data)

        is_thumbs_up = _parse_is_thumbs_up(d.pop("isThumbsUp"))

        def _parse_user_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        user_id = _parse_user_id(d.pop("userId"))

        created_at = d.pop("createdAt")

        updated_at = d.pop("updatedAt")

        def _parse_email(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        email = _parse_email(d.pop("email"))

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
