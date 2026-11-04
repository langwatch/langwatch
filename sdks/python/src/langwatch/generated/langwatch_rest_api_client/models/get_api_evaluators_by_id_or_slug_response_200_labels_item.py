from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetApiEvaluatorsByIdOrSlugResponse200LabelsItem")


@_attrs_define
class GetApiEvaluatorsByIdOrSlugResponse200LabelsItem:
    """
    Attributes:
        label (str):
        version (int):
    """

    label: str
    version: int

    def to_dict(self) -> dict[str, Any]:
        label = self.label

        version = self.version

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "label": label,
                "version": version,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        label = d.pop("label")

        version = d.pop("version")

        get_api_evaluators_by_id_or_slug_response_200_labels_item = cls(
            label=label,
            version=version,
        )

        return get_api_evaluators_by_id_or_slug_response_200_labels_item
