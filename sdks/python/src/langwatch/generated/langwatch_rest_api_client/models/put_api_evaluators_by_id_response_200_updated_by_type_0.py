from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="PutApiEvaluatorsByIdResponse200UpdatedByType0")


@_attrs_define
class PutApiEvaluatorsByIdResponse200UpdatedByType0:
    """
    Attributes:
        id (str):
        name (None | str):
    """

    id: str
    name: None | str

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name: None | str
        name = self.name

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "name": name,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        def _parse_name(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        name = _parse_name(d.pop("name"))

        put_api_evaluators_by_id_response_200_updated_by_type_0 = cls(
            id=id,
            name=name,
        )

        return put_api_evaluators_by_id_response_200_updated_by_type_0
