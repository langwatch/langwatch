from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="GetApiWorkflowsResponse200Item")


@_attrs_define
class GetApiWorkflowsResponse200Item:
    """
    Attributes:
        id (str):
        name (str):
        icon (None | str):
        description (None | str):
        is_evaluator (bool):
        is_component (bool):
        created_at (str):
        updated_at (str):
    """

    id: str
    name: str
    icon: None | str
    description: None | str
    is_evaluator: bool
    is_component: bool
    created_at: str
    updated_at: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        icon: None | str
        icon = self.icon

        description: None | str
        description = self.description

        is_evaluator = self.is_evaluator

        is_component = self.is_component

        created_at = self.created_at

        updated_at = self.updated_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "name": name,
                "icon": icon,
                "description": description,
                "isEvaluator": is_evaluator,
                "isComponent": is_component,
                "createdAt": created_at,
                "updatedAt": updated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        def _parse_icon(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        icon = _parse_icon(d.pop("icon"))

        def _parse_description(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        description = _parse_description(d.pop("description"))

        is_evaluator = d.pop("isEvaluator")

        is_component = d.pop("isComponent")

        created_at = d.pop("createdAt")

        updated_at = d.pop("updatedAt")

        get_api_workflows_response_200_item = cls(
            id=id,
            name=name,
            icon=icon,
            description=description,
            is_evaluator=is_evaluator,
            is_component=is_component,
            created_at=created_at,
            updated_at=updated_at,
        )

        get_api_workflows_response_200_item.additional_properties = d
        return get_api_workflows_response_200_item

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
