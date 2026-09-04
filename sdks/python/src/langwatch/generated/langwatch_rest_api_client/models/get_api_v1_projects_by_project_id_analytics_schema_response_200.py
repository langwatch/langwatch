from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_v1_projects_by_project_id_analytics_schema_response_200_datasets_item import (
        GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200DatasetsItem,
    )


T = TypeVar("T", bound="GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200")


@_attrs_define
class GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200:
    """
    Attributes:
        database (str):
        datasets (list[GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200DatasetsItem]):
    """

    database: str
    datasets: list[GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200DatasetsItem]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        database = self.database

        datasets = []
        for datasets_item_data in self.datasets:
            datasets_item = datasets_item_data.to_dict()
            datasets.append(datasets_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "database": database,
                "datasets": datasets,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_v1_projects_by_project_id_analytics_schema_response_200_datasets_item import (
            GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200DatasetsItem,
        )

        d = dict(src_dict)
        database = d.pop("database")

        datasets = []
        _datasets = d.pop("datasets")
        for datasets_item_data in _datasets:
            datasets_item = GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200DatasetsItem.from_dict(
                datasets_item_data
            )

            datasets.append(datasets_item)

        get_api_v1_projects_by_project_id_analytics_schema_response_200 = cls(
            database=database,
            datasets=datasets,
        )

        get_api_v1_projects_by_project_id_analytics_schema_response_200.additional_properties = d
        return get_api_v1_projects_by_project_id_analytics_schema_response_200

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
