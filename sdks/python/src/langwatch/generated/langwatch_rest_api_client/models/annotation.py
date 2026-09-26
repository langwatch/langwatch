from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.annotation_score_options import AnnotationScoreOptions


T = TypeVar("T", bound="Annotation")


@_attrs_define
class Annotation:
    """
    Attributes:
        id (str):
        project_id (str):
        trace_id (str):
        user_id (None | str):
        email (None | str):
        comment (None | str):
        is_thumbs_up (bool | None):
        score_options (AnnotationScoreOptions):
        expected_output (None | str):
        anchor_kind (None | str):
        anchor_id (None | str):
        anchor_path (None | str):
        created_at (str):
        updated_at (str):
    """

    id: str
    project_id: str
    trace_id: str
    user_id: None | str
    email: None | str
    comment: None | str
    is_thumbs_up: bool | None
    score_options: AnnotationScoreOptions
    expected_output: None | str
    anchor_kind: None | str
    anchor_id: None | str
    anchor_path: None | str
    created_at: str
    updated_at: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        project_id = self.project_id

        trace_id = self.trace_id

        user_id: None | str
        user_id = self.user_id

        email: None | str
        email = self.email

        comment: None | str
        comment = self.comment

        is_thumbs_up: bool | None
        is_thumbs_up = self.is_thumbs_up

        score_options = self.score_options.to_dict()

        expected_output: None | str
        expected_output = self.expected_output

        anchor_kind: None | str
        anchor_kind = self.anchor_kind

        anchor_id: None | str
        anchor_id = self.anchor_id

        anchor_path: None | str
        anchor_path = self.anchor_path

        created_at = self.created_at

        updated_at = self.updated_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "projectId": project_id,
                "traceId": trace_id,
                "userId": user_id,
                "email": email,
                "comment": comment,
                "isThumbsUp": is_thumbs_up,
                "scoreOptions": score_options,
                "expectedOutput": expected_output,
                "anchorKind": anchor_kind,
                "anchorId": anchor_id,
                "anchorPath": anchor_path,
                "createdAt": created_at,
                "updatedAt": updated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.annotation_score_options import AnnotationScoreOptions

        d = dict(src_dict)
        id = d.pop("id")

        project_id = d.pop("projectId")

        trace_id = d.pop("traceId")

        def _parse_user_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        user_id = _parse_user_id(d.pop("userId"))

        def _parse_email(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        email = _parse_email(d.pop("email"))

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

        score_options = AnnotationScoreOptions.from_dict(d.pop("scoreOptions"))

        def _parse_expected_output(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        expected_output = _parse_expected_output(d.pop("expectedOutput"))

        def _parse_anchor_kind(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        anchor_kind = _parse_anchor_kind(d.pop("anchorKind"))

        def _parse_anchor_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        anchor_id = _parse_anchor_id(d.pop("anchorId"))

        def _parse_anchor_path(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        anchor_path = _parse_anchor_path(d.pop("anchorPath"))

        created_at = d.pop("createdAt")

        updated_at = d.pop("updatedAt")

        annotation = cls(
            id=id,
            project_id=project_id,
            trace_id=trace_id,
            user_id=user_id,
            email=email,
            comment=comment,
            is_thumbs_up=is_thumbs_up,
            score_options=score_options,
            expected_output=expected_output,
            anchor_kind=anchor_kind,
            anchor_id=anchor_id,
            anchor_path=anchor_path,
            created_at=created_at,
            updated_at=updated_at,
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
