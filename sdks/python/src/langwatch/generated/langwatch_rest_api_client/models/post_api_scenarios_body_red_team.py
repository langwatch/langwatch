from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.post_api_scenarios_body_red_team_strategy import PostApiScenariosBodyRedTeamStrategy
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiScenariosBodyRedTeam")


@_attrs_define
class PostApiScenariosBodyRedTeam:
    """The attack a red_team scenario plays: goal, OWASP ids, strategy and turn budget.

    Attributes:
        attack_goal (str):
        owasp_ids (list[str]):
        strategy (PostApiScenariosBodyRedTeamStrategy | Unset):  Default: PostApiScenariosBodyRedTeamStrategy.CRESCENDO.
        max_turns (int | Unset):  Default: 30.
    """

    attack_goal: str
    owasp_ids: list[str]
    strategy: PostApiScenariosBodyRedTeamStrategy | Unset = PostApiScenariosBodyRedTeamStrategy.CRESCENDO
    max_turns: int | Unset = 30

    def to_dict(self) -> dict[str, Any]:
        attack_goal = self.attack_goal

        owasp_ids = self.owasp_ids

        strategy: str | Unset = UNSET
        if not isinstance(self.strategy, Unset):
            strategy = self.strategy.value

        max_turns = self.max_turns

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "attackGoal": attack_goal,
                "owaspIds": owasp_ids,
            }
        )
        if strategy is not UNSET:
            field_dict["strategy"] = strategy
        if max_turns is not UNSET:
            field_dict["maxTurns"] = max_turns

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        attack_goal = d.pop("attackGoal")

        owasp_ids = cast(list[str], d.pop("owaspIds"))

        _strategy = d.pop("strategy", UNSET)
        strategy: PostApiScenariosBodyRedTeamStrategy | Unset
        if isinstance(_strategy, Unset):
            strategy = UNSET
        else:
            strategy = PostApiScenariosBodyRedTeamStrategy(_strategy)

        max_turns = d.pop("maxTurns", UNSET)

        post_api_scenarios_body_red_team = cls(
            attack_goal=attack_goal,
            owasp_ids=owasp_ids,
            strategy=strategy,
            max_turns=max_turns,
        )

        return post_api_scenarios_body_red_team
