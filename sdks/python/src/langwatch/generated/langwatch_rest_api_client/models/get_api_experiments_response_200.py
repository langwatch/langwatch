from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

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

    def to_dict(self) -> dict[str, Any]:
        experiments = []
        for experiments_item_data in self.experiments:
            experiments_item = experiments_item_data.to_dict()
            experiments.append(experiments_item)

        pagination = self.pagination.to_dict()

        field_dict: dict[str, Any] = {}

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

        return get_api_experiments_response_200
