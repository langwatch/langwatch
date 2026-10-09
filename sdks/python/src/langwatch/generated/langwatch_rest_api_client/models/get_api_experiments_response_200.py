from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_experiments_response_200_experiments_item import GetApiExperimentsResponse200ExperimentsItem
    from ..models.get_api_experiments_response_200_pagination import GetApiExperimentsResponse200Pagination


T = TypeVar("T", bound="GetApiExperimentsResponse200")


@_attrs_define
class GetApiExperimentsResponse200:
    """
    Attributes:
        experiments (list[GetApiExperimentsResponse200ExperimentsItem]):
        pagination (GetApiExperimentsResponse200Pagination):
    """

    experiments: list[GetApiExperimentsResponse200ExperimentsItem]
    pagination: GetApiExperimentsResponse200Pagination
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        experiments = []
        for experiments_item_data in self.experiments:
            experiments_item = experiments_item_data.to_dict()
            experiments.append(experiments_item)

        pagination = self.pagination.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "experiments": experiments,
                "pagination": pagination,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_experiments_response_200_experiments_item import (
            GetApiExperimentsResponse200ExperimentsItem,
        )
        from ..models.get_api_experiments_response_200_pagination import GetApiExperimentsResponse200Pagination

        d = dict(src_dict)
        experiments = []
        _experiments = d.pop("experiments")
        for experiments_item_data in _experiments:
            experiments_item = GetApiExperimentsResponse200ExperimentsItem.from_dict(experiments_item_data)

            experiments.append(experiments_item)

        pagination = GetApiExperimentsResponse200Pagination.from_dict(d.pop("pagination"))

        get_api_experiments_response_200 = cls(
            experiments=experiments,
            pagination=pagination,
        )

        get_api_experiments_response_200.additional_properties = d
        return get_api_experiments_response_200

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
