from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

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

    def to_dict(self) -> dict[str, Any]:
        url = self.url

        detail: Literal["auto"] | Literal["high"] | Literal["low"] | Unset
        if isinstance(self.detail, Unset):
            detail = UNSET
        else:
            detail = self.detail

        field_dict: dict[str, Any] = {}

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

        return span_input_output_type_1_value_item_parts_item_type_2_image_url
