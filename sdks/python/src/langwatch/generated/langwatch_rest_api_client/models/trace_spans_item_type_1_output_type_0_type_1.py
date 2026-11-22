from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.trace_spans_item_type_1_output_type_0_type_1_value_type_0_type_3 import (
        TraceSpansItemType1OutputType0Type1ValueType0Type3,
    )


T = TypeVar("T", bound="TraceSpansItemType1OutputType0Type1")


@_attrs_define
class TraceSpansItemType1OutputType0Type1:
    """
    Attributes:
        type_ (Literal['evaluation_result'] | Literal['guardrail_result']):
        value (bool | float | list[Any] | None | str | TraceSpansItemType1OutputType0Type1ValueType0Type3):
    """

    type_: Literal["evaluation_result"] | Literal["guardrail_result"]
    value: bool | float | list[Any] | None | str | TraceSpansItemType1OutputType0Type1ValueType0Type3
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.trace_spans_item_type_1_output_type_0_type_1_value_type_0_type_3 import (
            TraceSpansItemType1OutputType0Type1ValueType0Type3,
        )

        type_: Literal["evaluation_result"] | Literal["guardrail_result"]
        type_ = self.type_

        value: bool | dict[str, Any] | float | list[Any] | None | str
        if isinstance(self.value, TraceSpansItemType1OutputType0Type1ValueType0Type3):
            value = self.value.to_dict()
        elif isinstance(self.value, list):
            value = self.value

        else:
            value = self.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "value": value,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.trace_spans_item_type_1_output_type_0_type_1_value_type_0_type_3 import (
            TraceSpansItemType1OutputType0Type1ValueType0Type3,
        )

        d = dict(src_dict)

        def _parse_type_(data: object) -> Literal["evaluation_result"] | Literal["guardrail_result"]:
            type_type_0 = cast(Literal["evaluation_result"], data)
            if type_type_0 != "evaluation_result":
                raise ValueError(f"type_type_0 must match const 'evaluation_result', got '{type_type_0}'")
            return type_type_0
            type_type_1 = cast(Literal["guardrail_result"], data)
            if type_type_1 != "guardrail_result":
                raise ValueError(f"type_type_1 must match const 'guardrail_result', got '{type_type_1}'")
            return type_type_1

        type_ = _parse_type_(d.pop("type"))

        def _parse_value(
            data: object,
        ) -> bool | float | list[Any] | None | str | TraceSpansItemType1OutputType0Type1ValueType0Type3:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                value_type_0_type_3 = TraceSpansItemType1OutputType0Type1ValueType0Type3.from_dict(data)

                return value_type_0_type_3
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, list):
                    raise TypeError()
                value_type_0_type_4 = cast(list[Any], data)

                return value_type_0_type_4
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                bool | float | list[Any] | None | str | TraceSpansItemType1OutputType0Type1ValueType0Type3, data
            )

        value = _parse_value(d.pop("value"))

        trace_spans_item_type_1_output_type_0_type_1 = cls(
            type_=type_,
            value=value,
        )

        trace_spans_item_type_1_output_type_0_type_1.additional_properties = d
        return trace_spans_item_type_1_output_type_0_type_1

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
