from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.annotation import Annotation


T = TypeVar("T", bound="GetApiAnnotationsIdResponse200")


@_attrs_define
class GetApiAnnotationsIdResponse200:
    """
    Attributes:
        data (Annotation):
    """

    data: Annotation

    def to_dict(self) -> dict[str, Any]:
        data = self.data.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "data": data,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.annotation import Annotation

        d = dict(src_dict)
        data = Annotation.from_dict(d.pop("data"))

        get_api_annotations_id_response_200 = cls(
            data=data,
        )

        return get_api_annotations_id_response_200
