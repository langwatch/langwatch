from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="GetApiExperimentsResponse200ExperimentsItem")


@_attrs_define
class GetApiExperimentsResponse200ExperimentsItem:
    """
    Attributes:
        id (str):
        slug (str):
        name (None | str):
        type_ (str):
        workflow_id (None | str):
        created_at (str):
        updated_at (str):
        runs_count (float):
        last_run_at (None | str):
    """

    id: str
    slug: str
    name: None | str
    type_: str
    workflow_id: None | str
    created_at: str
    updated_at: str
    runs_count: float
    last_run_at: None | str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        slug = self.slug

        name: None | str
        name = self.name

        type_ = self.type_

        workflow_id: None | str
        workflow_id = self.workflow_id

        created_at = self.created_at

        updated_at = self.updated_at

        runs_count = self.runs_count

        last_run_at: None | str
        last_run_at = self.last_run_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "slug": slug,
                "name": name,
                "type": type_,
                "workflowId": workflow_id,
                "createdAt": created_at,
                "updatedAt": updated_at,
                "runsCount": runs_count,
                "lastRunAt": last_run_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        slug = d.pop("slug")

        def _parse_name(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        name = _parse_name(d.pop("name"))

        type_ = d.pop("type")

        def _parse_workflow_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        workflow_id = _parse_workflow_id(d.pop("workflowId"))

        created_at = d.pop("createdAt")

        updated_at = d.pop("updatedAt")

        runs_count = d.pop("runsCount")

        def _parse_last_run_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        last_run_at = _parse_last_run_at(d.pop("lastRunAt"))

        get_api_experiments_response_200_experiments_item = cls(
            id=id,
            slug=slug,
            name=name,
            type_=type_,
            workflow_id=workflow_id,
            created_at=created_at,
            updated_at=updated_at,
            runs_count=runs_count,
            last_run_at=last_run_at,
        )

        get_api_experiments_response_200_experiments_item.additional_properties = d
        return get_api_experiments_response_200_experiments_item

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
