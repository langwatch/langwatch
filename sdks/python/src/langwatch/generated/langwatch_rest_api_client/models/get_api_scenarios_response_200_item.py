from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="GetApiScenariosResponse200Item")


@_attrs_define
class GetApiScenariosResponse200Item:
    """
    Attributes:
        id (str):
        name (str):
        situation (str):
        criteria (list[str]):
        labels (list[str]):
    """

    id: str
    name: str
    situation: str
    criteria: list[str]
    labels: list[str]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        situation = self.situation

        criteria = self.criteria

        labels = self.labels

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "name": name,
                "situation": situation,
                "criteria": criteria,
                "labels": labels,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        situation = d.pop("situation")

        criteria = cast(list[str], d.pop("criteria"))

        labels = cast(list[str], d.pop("labels"))

        get_api_scenarios_response_200_item = cls(
            id=id,
            name=name,
            situation=situation,
            criteria=criteria,
            labels=labels,
        )

        get_api_scenarios_response_200_item.additional_properties = d
        return get_api_scenarios_response_200_item

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
