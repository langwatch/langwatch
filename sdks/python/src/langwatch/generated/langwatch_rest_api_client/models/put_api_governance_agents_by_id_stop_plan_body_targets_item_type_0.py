from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PutApiGovernanceAgentsByIdStopPlanBodyTargetsItemType0")


@_attrs_define
class PutApiGovernanceAgentsByIdStopPlanBodyTargetsItemType0:
    """
    Attributes:
        kind (Literal['databricks_serving_endpoint']):
        ingestion_source_id (str):
        endpoint_name (str):
    """

    kind: Literal["databricks_serving_endpoint"]
    ingestion_source_id: str
    endpoint_name: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        kind = self.kind

        ingestion_source_id = self.ingestion_source_id

        endpoint_name = self.endpoint_name

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "kind": kind,
                "ingestionSourceId": ingestion_source_id,
                "endpointName": endpoint_name,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        kind = cast(Literal["databricks_serving_endpoint"], d.pop("kind"))
        if kind != "databricks_serving_endpoint":
            raise ValueError(f"kind must match const 'databricks_serving_endpoint', got '{kind}'")

        ingestion_source_id = d.pop("ingestionSourceId")

        endpoint_name = d.pop("endpointName")

        put_api_governance_agents_by_id_stop_plan_body_targets_item_type_0 = cls(
            kind=kind,
            ingestion_source_id=ingestion_source_id,
            endpoint_name=endpoint_name,
        )

        put_api_governance_agents_by_id_stop_plan_body_targets_item_type_0.additional_properties = d
        return put_api_governance_agents_by_id_stop_plan_body_targets_item_type_0

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
