from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="GetApiV1QueryReferenceResponse200DecisionTableItem")


@_attrs_define
class GetApiV1QueryReferenceResponse200DecisionTableItem:
    """
    Attributes:
        when (str):
        use (str):
        why (str):
    """

    when: str
    use: str
    why: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        when = self.when

        use = self.use

        why = self.why

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "when": when,
                "use": use,
                "why": why,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        when = d.pop("when")

        use = d.pop("use")

        why = d.pop("why")

        get_api_v1_query_reference_response_200_decision_table_item = cls(
            when=when,
            use=use,
            why=why,
        )

        get_api_v1_query_reference_response_200_decision_table_item.additional_properties = d
        return get_api_v1_query_reference_response_200_decision_table_item

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
