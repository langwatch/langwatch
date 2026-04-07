from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PutApiScenariosByIdBody")


@_attrs_define
class PutApiScenariosByIdBody:
    """
    Attributes:
        name (str | Unset):
        situation (str | Unset):
        criteria (list[str] | Unset):
        labels (list[str] | Unset):
    """

    name: str | Unset = UNSET
    situation: str | Unset = UNSET
    criteria: list[str] | Unset = UNSET
    labels: list[str] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        situation = self.situation

        criteria: list[str] | Unset = UNSET
        if not isinstance(self.criteria, Unset):
            criteria = self.criteria

        labels: list[str] | Unset = UNSET
        if not isinstance(self.labels, Unset):
            labels = self.labels

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if name is not UNSET:
            field_dict["name"] = name
        if situation is not UNSET:
            field_dict["situation"] = situation
        if criteria is not UNSET:
            field_dict["criteria"] = criteria
        if labels is not UNSET:
            field_dict["labels"] = labels

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name", UNSET)

        situation = d.pop("situation", UNSET)

        criteria = cast(list[str], d.pop("criteria", UNSET))

        labels = cast(list[str], d.pop("labels", UNSET))

        put_api_scenarios_by_id_body = cls(
            name=name,
            situation=situation,
            criteria=criteria,
            labels=labels,
        )

        put_api_scenarios_by_id_body.additional_properties = d
        return put_api_scenarios_by_id_body

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
