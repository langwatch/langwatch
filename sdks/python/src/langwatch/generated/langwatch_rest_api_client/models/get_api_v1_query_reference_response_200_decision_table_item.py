from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

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

    def to_dict(self) -> dict[str, Any]:
        when = self.when

        use = self.use

        why = self.why

        field_dict: dict[str, Any] = {}

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

        return get_api_v1_query_reference_response_200_decision_table_item
