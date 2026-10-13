from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="SpanInputOutputType1ValueItemPartsItemType2ImageUrl")


@_attrs_define
class SpanInputOutputType1ValueItemPartsItemType2ImageUrl:
    """
    Attributes:
        url (str):
        detail (Literal['auto'] | Literal['high'] | Literal['low'] | Unset):
    """

    url: str
    detail: Literal["auto"] | Literal["high"] | Literal["low"] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        url = self.url

        detail: Literal["auto"] | Literal["high"] | Literal["low"] | Unset
        if isinstance(self.detail, Unset):
            detail = UNSET
        else:
            detail = self.detail

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "url": url,
            }
        )
        if detail is not UNSET:
            field_dict["detail"] = detail

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        url = d.pop("url")

        def _parse_detail(data: object) -> Literal["auto"] | Literal["high"] | Literal["low"] | Unset:
            if isinstance(data, Unset):
                return data
            detail_type_0 = cast(Literal["auto"], data)
            if detail_type_0 != "auto":
                raise ValueError(f"detail_type_0 must match const 'auto', got '{detail_type_0}'")
            return detail_type_0
            detail_type_1 = cast(Literal["low"], data)
            if detail_type_1 != "low":
                raise ValueError(f"detail_type_1 must match const 'low', got '{detail_type_1}'")
            return detail_type_1
            detail_type_2 = cast(Literal["high"], data)
            if detail_type_2 != "high":
                raise ValueError(f"detail_type_2 must match const 'high', got '{detail_type_2}'")
            return detail_type_2

        detail = _parse_detail(d.pop("detail", UNSET))

        span_input_output_type_1_value_item_parts_item_type_2_image_url = cls(
            url=url,
            detail=detail,
        )

        span_input_output_type_1_value_item_parts_item_type_2_image_url.additional_properties = d
        return span_input_output_type_1_value_item_parts_item_type_2_image_url

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
