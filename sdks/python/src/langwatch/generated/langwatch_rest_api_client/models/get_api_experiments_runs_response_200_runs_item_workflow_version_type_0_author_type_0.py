from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetApiExperimentsRunsResponse200RunsItemWorkflowVersionType0AuthorType0")


@_attrs_define
class GetApiExperimentsRunsResponse200RunsItemWorkflowVersionType0AuthorType0:
    """
    Attributes:
        name (None | str):
        image (None | str):
    """

    name: None | str
    image: None | str

    def to_dict(self) -> dict[str, Any]:
        name: None | str
        name = self.name

        image: None | str
        image = self.image

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "image": image,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)

        def _parse_name(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        name = _parse_name(d.pop("name"))

        def _parse_image(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        image = _parse_image(d.pop("image"))

        get_api_experiments_runs_response_200_runs_item_workflow_version_type_0_author_type_0 = cls(
            name=name,
            image=image,
        )

        return get_api_experiments_runs_response_200_runs_item_workflow_version_type_0_author_type_0
