from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.list_agent_versions_response_200_data_item import ListAgentVersionsResponse200DataItem
    from ..models.list_agent_versions_response_200_labels_item import ListAgentVersionsResponse200LabelsItem


T = TypeVar("T", bound="ListAgentVersionsResponse200")


@_attrs_define
class ListAgentVersionsResponse200:
    """
    Attributes:
        data (list[ListAgentVersionsResponse200DataItem]):
        labels (list[ListAgentVersionsResponse200LabelsItem]):
    """

    data: list[ListAgentVersionsResponse200DataItem]
    labels: list[ListAgentVersionsResponse200LabelsItem]

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
        from ..models.list_agent_versions_response_200_data_item import ListAgentVersionsResponse200DataItem
        from ..models.list_agent_versions_response_200_labels_item import ListAgentVersionsResponse200LabelsItem

        d = dict(src_dict)
        data = []
        _data = d.pop("data")
        for data_item_data in _data:
            data_item = ListAgentVersionsResponse200DataItem.from_dict(data_item_data)

            data.append(data_item)

        labels = []
        _labels = d.pop("labels")
        for labels_item_data in _labels:
            labels_item = ListAgentVersionsResponse200LabelsItem.from_dict(labels_item_data)

            labels.append(labels_item)

        list_agent_versions_response_200 = cls(
            data=data,
            labels=labels,
        )

        return list_agent_versions_response_200
