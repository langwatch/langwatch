from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.list_suite_templates_response_200_item_scenarios_item_attack_strategy import (
    ListSuiteTemplatesResponse200ItemScenariosItemAttackStrategy,
)

T = TypeVar("T", bound="ListSuiteTemplatesResponse200ItemScenariosItemAttack")


@_attrs_define
class ListSuiteTemplatesResponse200ItemScenariosItemAttack:
    """
    Attributes:
        attack_goal (str):
        owasp_ids (list[str]):
        strategy (ListSuiteTemplatesResponse200ItemScenariosItemAttackStrategy):
        max_turns (int):  Default: 30.
    """

    attack_goal: str
    owasp_ids: list[str]
    strategy: ListSuiteTemplatesResponse200ItemScenariosItemAttackStrategy
    max_turns: int = 30

    def to_dict(self) -> dict[str, Any]:
        attack_goal = self.attack_goal

        owasp_ids = self.owasp_ids

        strategy = self.strategy.value

        max_turns = self.max_turns

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "attackGoal": attack_goal,
                "owaspIds": owasp_ids,
                "strategy": strategy,
                "maxTurns": max_turns,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        attack_goal = d.pop("attackGoal")

        owasp_ids = cast(list[str], d.pop("owaspIds"))

        strategy = ListSuiteTemplatesResponse200ItemScenariosItemAttackStrategy(d.pop("strategy"))

        max_turns = d.pop("maxTurns")

        list_suite_templates_response_200_item_scenarios_item_attack = cls(
            attack_goal=attack_goal,
            owasp_ids=owasp_ids,
            strategy=strategy,
            max_turns=max_turns,
        )

        return list_suite_templates_response_200_item_scenarios_item_attack
