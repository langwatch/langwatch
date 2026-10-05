from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_v1_query_reference_response_200_decision_table_item import (
        GetApiV1QueryReferenceResponse200DecisionTableItem,
    )
    from ..models.get_api_v1_query_reference_response_200_examples_item import (
        GetApiV1QueryReferenceResponse200ExamplesItem,
    )
    from ..models.get_api_v1_query_reference_response_200_lwql import GetApiV1QueryReferenceResponse200Lwql
    from ..models.get_api_v1_query_reference_response_200_trace_filter import (
        GetApiV1QueryReferenceResponse200TraceFilter,
    )


T = TypeVar("T", bound="GetApiV1QueryReferenceResponse200")


@_attrs_define
class GetApiV1QueryReferenceResponse200:
    """
    Attributes:
        version (str):
        lwql (GetApiV1QueryReferenceResponse200Lwql):
        trace_filter (GetApiV1QueryReferenceResponse200TraceFilter):
        examples (list[GetApiV1QueryReferenceResponse200ExamplesItem]):
        decision_table (list[GetApiV1QueryReferenceResponse200DecisionTableItem]):
    """

    version: str
    lwql: GetApiV1QueryReferenceResponse200Lwql
    trace_filter: GetApiV1QueryReferenceResponse200TraceFilter
    examples: list[GetApiV1QueryReferenceResponse200ExamplesItem]
    decision_table: list[GetApiV1QueryReferenceResponse200DecisionTableItem]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        version = self.version

        lwql = self.lwql.to_dict()

        trace_filter = self.trace_filter.to_dict()

        examples = []
        for examples_item_data in self.examples:
            examples_item = examples_item_data.to_dict()
            examples.append(examples_item)

        decision_table = []
        for decision_table_item_data in self.decision_table:
            decision_table_item = decision_table_item_data.to_dict()
            decision_table.append(decision_table_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "version": version,
                "lwql": lwql,
                "traceFilter": trace_filter,
                "examples": examples,
                "decisionTable": decision_table,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_v1_query_reference_response_200_decision_table_item import (
            GetApiV1QueryReferenceResponse200DecisionTableItem,
        )
        from ..models.get_api_v1_query_reference_response_200_examples_item import (
            GetApiV1QueryReferenceResponse200ExamplesItem,
        )
        from ..models.get_api_v1_query_reference_response_200_lwql import GetApiV1QueryReferenceResponse200Lwql
        from ..models.get_api_v1_query_reference_response_200_trace_filter import (
            GetApiV1QueryReferenceResponse200TraceFilter,
        )

        d = dict(src_dict)
        version = d.pop("version")

        lwql = GetApiV1QueryReferenceResponse200Lwql.from_dict(d.pop("lwql"))

        trace_filter = GetApiV1QueryReferenceResponse200TraceFilter.from_dict(d.pop("traceFilter"))

        examples = []
        _examples = d.pop("examples")
        for examples_item_data in _examples:
            examples_item = GetApiV1QueryReferenceResponse200ExamplesItem.from_dict(examples_item_data)

            examples.append(examples_item)

        decision_table = []
        _decision_table = d.pop("decisionTable")
        for decision_table_item_data in _decision_table:
            decision_table_item = GetApiV1QueryReferenceResponse200DecisionTableItem.from_dict(decision_table_item_data)

            decision_table.append(decision_table_item)

        get_api_v1_query_reference_response_200 = cls(
            version=version,
            lwql=lwql,
            trace_filter=trace_filter,
            examples=examples,
            decision_table=decision_table,
        )

        get_api_v1_query_reference_response_200.additional_properties = d
        return get_api_v1_query_reference_response_200

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
