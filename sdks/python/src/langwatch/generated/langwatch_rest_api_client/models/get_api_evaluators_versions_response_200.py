from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_api_evaluators_versions_response_200_data_item import GetApiEvaluatorsVersionsResponse200DataItem
    from ..models.get_api_evaluators_versions_response_200_labels_item import (
        GetApiEvaluatorsVersionsResponse200LabelsItem,
    )


T = TypeVar("T", bound="GetApiEvaluatorsVersionsResponse200")


@_attrs_define
class GetApiEvaluatorsVersionsResponse200:
    """
    Attributes:
        data (list[GetApiEvaluatorsVersionsResponse200DataItem]):
        labels (list[GetApiEvaluatorsVersionsResponse200LabelsItem]):
    """

    data: list[GetApiEvaluatorsVersionsResponse200DataItem]
    labels: list[GetApiEvaluatorsVersionsResponse200LabelsItem]

    def to_dict(self) -> dict[str, Any]:
        data = []
        for data_item_data in self.data:
            data_item = data_item_data.to_dict()
            data.append(data_item)

        labels = []
        for labels_item_data in self.labels:
            labels_item = labels_item_data.to_dict()
            labels.append(labels_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "data": data,
                "labels": labels,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_evaluators_versions_response_200_data_item import (
            GetApiEvaluatorsVersionsResponse200DataItem,
        )
        from ..models.get_api_evaluators_versions_response_200_labels_item import (
            GetApiEvaluatorsVersionsResponse200LabelsItem,
        )

        d = dict(src_dict)
        data = []
        _data = d.pop("data")
        for data_item_data in _data:
            data_item = GetApiEvaluatorsVersionsResponse200DataItem.from_dict(data_item_data)

            data.append(data_item)

        labels = []
        _labels = d.pop("labels")
        for labels_item_data in _labels:
            labels_item = GetApiEvaluatorsVersionsResponse200LabelsItem.from_dict(labels_item_data)

            labels.append(labels_item)

        get_api_evaluators_versions_response_200 = cls(
            data=data,
            labels=labels,
        )

        return get_api_evaluators_versions_response_200
