from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.list_suite_templates_response_200_item_scenarios_item_attack import (
        ListSuiteTemplatesResponse200ItemScenariosItemAttack,
    )


T = TypeVar("T", bound="ListSuiteTemplatesResponse200ItemScenariosItem")


@_attrs_define
class ListSuiteTemplatesResponse200ItemScenariosItem:
    """
    Attributes:
        key (str):
        name (str):
        situation (str):
        criteria (list[str]):
        labels (list[str]):
        attack (ListSuiteTemplatesResponse200ItemScenariosItemAttack | Unset):
    """

    key: str
    name: str
    situation: str
    criteria: list[str]
    labels: list[str]
    attack: ListSuiteTemplatesResponse200ItemScenariosItemAttack | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        key = self.key

        name = self.name

        situation = self.situation

        criteria = self.criteria

        labels = self.labels

        attack: dict[str, Any] | Unset = UNSET
        if not isinstance(self.attack, Unset):
            attack = self.attack.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "key": key,
                "name": name,
                "situation": situation,
                "criteria": criteria,
                "labels": labels,
            }
        )
        if attack is not UNSET:
            field_dict["attack"] = attack

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.list_suite_templates_response_200_item_scenarios_item_attack import (
            ListSuiteTemplatesResponse200ItemScenariosItemAttack,
        )

        d = dict(src_dict)
        key = d.pop("key")

        name = d.pop("name")

        situation = d.pop("situation")

        criteria = cast(list[str], d.pop("criteria"))

        labels = cast(list[str], d.pop("labels"))

        _attack = d.pop("attack", UNSET)
        attack: ListSuiteTemplatesResponse200ItemScenariosItemAttack | Unset
        if isinstance(_attack, Unset):
            attack = UNSET
        else:
            attack = ListSuiteTemplatesResponse200ItemScenariosItemAttack.from_dict(_attack)

        list_suite_templates_response_200_item_scenarios_item = cls(
            key=key,
            name=name,
            situation=situation,
            criteria=criteria,
            labels=labels,
            attack=attack,
        )

        return list_suite_templates_response_200_item_scenarios_item
