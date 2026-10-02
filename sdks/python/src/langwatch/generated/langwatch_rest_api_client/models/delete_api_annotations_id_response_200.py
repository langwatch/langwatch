from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="DeleteApiAnnotationsIdResponse200")


@_attrs_define
class DeleteApiAnnotationsIdResponse200:
    """
    Attributes:
        status (str):
        message (str):
    """

    status: str
    message: str

    def to_dict(self) -> dict[str, Any]:
        status = self.status

        message = self.message

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "status": status,
                "message": message,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        status = d.pop("status")

        message = d.pop("message")

        delete_api_annotations_id_response_200 = cls(
            status=status,
            message=message,
        )

        return delete_api_annotations_id_response_200
