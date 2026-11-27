from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostApiGovernanceAgentStopsByIdRestoreResponse202DataTargetsItemTargetType2")


@_attrs_define
class PostApiGovernanceAgentStopsByIdRestoreResponse202DataTargetsItemTargetType2:
    """
    Attributes:
        kind (Literal['gateway_virtual_key']):
        virtual_key_id (str):
    """

    kind: Literal["gateway_virtual_key"]
    virtual_key_id: str

    def to_dict(self) -> dict[str, Any]:
        kind = self.kind

        virtual_key_id = self.virtual_key_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "kind": kind,
                "virtualKeyId": virtual_key_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        kind = cast(Literal["gateway_virtual_key"], d.pop("kind"))
        if kind != "gateway_virtual_key":
            raise ValueError(f"kind must match const 'gateway_virtual_key', got '{kind}'")

        virtual_key_id = d.pop("virtualKeyId")

        post_api_governance_agent_stops_by_id_restore_response_202_data_targets_item_target_type_2 = cls(
            kind=kind,
            virtual_key_id=virtual_key_id,
        )

        return post_api_governance_agent_stops_by_id_restore_response_202_data_targets_item_target_type_2
