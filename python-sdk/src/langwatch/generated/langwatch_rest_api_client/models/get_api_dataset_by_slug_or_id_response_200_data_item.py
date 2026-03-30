from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_dataset_by_slug_or_id_response_200_data_item_entry import (
        GetApiDatasetBySlugOrIdResponse200DataItemEntry,
    )


T = TypeVar("T", bound="GetApiDatasetBySlugOrIdResponse200DataItem")


@_attrs_define
class GetApiDatasetBySlugOrIdResponse200DataItem:
    """
    Attributes:
        id (str):
        dataset_id (str):
        project_id (str):
        entry (GetApiDatasetBySlugOrIdResponse200DataItemEntry):
        created_at (str):
        updated_at (str):
    """

    id: str
    dataset_id: str
    project_id: str
    entry: "GetApiDatasetBySlugOrIdResponse200DataItemEntry"
    created_at: str
    updated_at: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        dataset_id = self.dataset_id

        project_id = self.project_id

        entry = self.entry.to_dict()

        created_at = self.created_at

        updated_at = self.updated_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "datasetId": dataset_id,
                "projectId": project_id,
                "entry": entry,
                "createdAt": created_at,
                "updatedAt": updated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_dataset_by_slug_or_id_response_200_data_item_entry import (
            GetApiDatasetBySlugOrIdResponse200DataItemEntry,
        )

        d = dict(src_dict)
        id = d.pop("id")

        dataset_id = d.pop("datasetId")

        project_id = d.pop("projectId")

        entry = GetApiDatasetBySlugOrIdResponse200DataItemEntry.from_dict(d.pop("entry"))

        created_at = d.pop("createdAt")

        updated_at = d.pop("updatedAt")

        get_api_dataset_by_slug_or_id_response_200_data_item = cls(
            id=id,
            dataset_id=dataset_id,
            project_id=project_id,
            entry=entry,
            created_at=created_at,
            updated_at=updated_at,
        )

        get_api_dataset_by_slug_or_id_response_200_data_item.additional_properties = d
        return get_api_dataset_by_slug_or_id_response_200_data_item

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
