from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_api_governance_agents_by_id_stop_plan_response_200_data_targets_item_target_type_0 import (
        GetApiGovernanceAgentsByIdStopPlanResponse200DataTargetsItemTargetType0,
    )
    from ..models.get_api_governance_agents_by_id_stop_plan_response_200_data_targets_item_target_type_1 import (
        GetApiGovernanceAgentsByIdStopPlanResponse200DataTargetsItemTargetType1,
    )
    from ..models.get_api_governance_agents_by_id_stop_plan_response_200_data_targets_item_target_type_2 import (
        GetApiGovernanceAgentsByIdStopPlanResponse200DataTargetsItemTargetType2,
    )


T = TypeVar("T", bound="GetApiGovernanceAgentsByIdStopPlanResponse200DataTargetsItem")


@_attrs_define
class GetApiGovernanceAgentsByIdStopPlanResponse200DataTargetsItem:
    """
    Attributes:
        id (str):
        label (str):
        target (GetApiGovernanceAgentsByIdStopPlanResponse200DataTargetsItemTargetType0 |
            GetApiGovernanceAgentsByIdStopPlanResponse200DataTargetsItemTargetType1 |
            GetApiGovernanceAgentsByIdStopPlanResponse200DataTargetsItemTargetType2):
    """

    id: str
    label: str
    target: (
        GetApiGovernanceAgentsByIdStopPlanResponse200DataTargetsItemTargetType0
        | GetApiGovernanceAgentsByIdStopPlanResponse200DataTargetsItemTargetType1
        | GetApiGovernanceAgentsByIdStopPlanResponse200DataTargetsItemTargetType2
    )

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_api_governance_agents_by_id_stop_plan_response_200_data_targets_item_target_type_0 import (
            GetApiGovernanceAgentsByIdStopPlanResponse200DataTargetsItemTargetType0,
        )
        from ..models.get_api_governance_agents_by_id_stop_plan_response_200_data_targets_item_target_type_1 import (
            GetApiGovernanceAgentsByIdStopPlanResponse200DataTargetsItemTargetType1,
        )

        id = self.id

        label = self.label

        target: dict[str, Any]
        if isinstance(self.target, GetApiGovernanceAgentsByIdStopPlanResponse200DataTargetsItemTargetType0):
            target = self.target.to_dict()
        elif isinstance(self.target, GetApiGovernanceAgentsByIdStopPlanResponse200DataTargetsItemTargetType1):
            target = self.target.to_dict()
        else:
            target = self.target.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "label": label,
                "target": target,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_governance_agents_by_id_stop_plan_response_200_data_targets_item_target_type_0 import (
            GetApiGovernanceAgentsByIdStopPlanResponse200DataTargetsItemTargetType0,
        )
        from ..models.get_api_governance_agents_by_id_stop_plan_response_200_data_targets_item_target_type_1 import (
            GetApiGovernanceAgentsByIdStopPlanResponse200DataTargetsItemTargetType1,
        )
        from ..models.get_api_governance_agents_by_id_stop_plan_response_200_data_targets_item_target_type_2 import (
            GetApiGovernanceAgentsByIdStopPlanResponse200DataTargetsItemTargetType2,
        )

        d = dict(src_dict)
        id = d.pop("id")

        label = d.pop("label")

        def _parse_target(
            data: object,
        ) -> (
            GetApiGovernanceAgentsByIdStopPlanResponse200DataTargetsItemTargetType0
            | GetApiGovernanceAgentsByIdStopPlanResponse200DataTargetsItemTargetType1
            | GetApiGovernanceAgentsByIdStopPlanResponse200DataTargetsItemTargetType2
        ):
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                target_type_0 = GetApiGovernanceAgentsByIdStopPlanResponse200DataTargetsItemTargetType0.from_dict(data)

                return target_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                target_type_1 = GetApiGovernanceAgentsByIdStopPlanResponse200DataTargetsItemTargetType1.from_dict(data)

                return target_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            target_type_2 = GetApiGovernanceAgentsByIdStopPlanResponse200DataTargetsItemTargetType2.from_dict(data)

            return target_type_2

        target = _parse_target(d.pop("target"))

        get_api_governance_agents_by_id_stop_plan_response_200_data_targets_item = cls(
            id=id,
            label=label,
            target=target,
        )

        return get_api_governance_agents_by_id_stop_plan_response_200_data_targets_item
