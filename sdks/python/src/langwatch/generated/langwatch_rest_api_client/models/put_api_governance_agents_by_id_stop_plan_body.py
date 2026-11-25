from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.put_api_governance_agents_by_id_stop_plan_body_targets_item_type_0 import (
        PutApiGovernanceAgentsByIdStopPlanBodyTargetsItemType0,
    )
    from ..models.put_api_governance_agents_by_id_stop_plan_body_targets_item_type_1 import (
        PutApiGovernanceAgentsByIdStopPlanBodyTargetsItemType1,
    )
    from ..models.put_api_governance_agents_by_id_stop_plan_body_targets_item_type_2 import (
        PutApiGovernanceAgentsByIdStopPlanBodyTargetsItemType2,
    )


T = TypeVar("T", bound="PutApiGovernanceAgentsByIdStopPlanBody")


@_attrs_define
class PutApiGovernanceAgentsByIdStopPlanBody:
    """
    Attributes:
        targets (list[PutApiGovernanceAgentsByIdStopPlanBodyTargetsItemType0 |
            PutApiGovernanceAgentsByIdStopPlanBodyTargetsItemType1 |
            PutApiGovernanceAgentsByIdStopPlanBodyTargetsItemType2]):
        expected_version (int | Unset):
    """

    targets: list[
        PutApiGovernanceAgentsByIdStopPlanBodyTargetsItemType0
        | PutApiGovernanceAgentsByIdStopPlanBodyTargetsItemType1
        | PutApiGovernanceAgentsByIdStopPlanBodyTargetsItemType2
    ]
    expected_version: int | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.put_api_governance_agents_by_id_stop_plan_body_targets_item_type_0 import (
            PutApiGovernanceAgentsByIdStopPlanBodyTargetsItemType0,
        )
        from ..models.put_api_governance_agents_by_id_stop_plan_body_targets_item_type_1 import (
            PutApiGovernanceAgentsByIdStopPlanBodyTargetsItemType1,
        )

        targets = []
        for targets_item_data in self.targets:
            targets_item: dict[str, Any]
            if isinstance(targets_item_data, PutApiGovernanceAgentsByIdStopPlanBodyTargetsItemType0):
                targets_item = targets_item_data.to_dict()
            elif isinstance(targets_item_data, PutApiGovernanceAgentsByIdStopPlanBodyTargetsItemType1):
                targets_item = targets_item_data.to_dict()
            else:
                targets_item = targets_item_data.to_dict()

            targets.append(targets_item)

        expected_version = self.expected_version

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "targets": targets,
            }
        )
        if expected_version is not UNSET:
            field_dict["expectedVersion"] = expected_version

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.put_api_governance_agents_by_id_stop_plan_body_targets_item_type_0 import (
            PutApiGovernanceAgentsByIdStopPlanBodyTargetsItemType0,
        )
        from ..models.put_api_governance_agents_by_id_stop_plan_body_targets_item_type_1 import (
            PutApiGovernanceAgentsByIdStopPlanBodyTargetsItemType1,
        )
        from ..models.put_api_governance_agents_by_id_stop_plan_body_targets_item_type_2 import (
            PutApiGovernanceAgentsByIdStopPlanBodyTargetsItemType2,
        )

        d = dict(src_dict)
        targets = []
        _targets = d.pop("targets")
        for targets_item_data in _targets:

            def _parse_targets_item(
                data: object,
            ) -> (
                PutApiGovernanceAgentsByIdStopPlanBodyTargetsItemType0
                | PutApiGovernanceAgentsByIdStopPlanBodyTargetsItemType1
                | PutApiGovernanceAgentsByIdStopPlanBodyTargetsItemType2
            ):
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    targets_item_type_0 = PutApiGovernanceAgentsByIdStopPlanBodyTargetsItemType0.from_dict(data)

                    return targets_item_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    targets_item_type_1 = PutApiGovernanceAgentsByIdStopPlanBodyTargetsItemType1.from_dict(data)

                    return targets_item_type_1
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                targets_item_type_2 = PutApiGovernanceAgentsByIdStopPlanBodyTargetsItemType2.from_dict(data)

                return targets_item_type_2

            targets_item = _parse_targets_item(targets_item_data)

            targets.append(targets_item)

        expected_version = d.pop("expectedVersion", UNSET)

        put_api_governance_agents_by_id_stop_plan_body = cls(
            targets=targets,
            expected_version=expected_version,
        )

        put_api_governance_agents_by_id_stop_plan_body.additional_properties = d
        return put_api_governance_agents_by_id_stop_plan_body

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
