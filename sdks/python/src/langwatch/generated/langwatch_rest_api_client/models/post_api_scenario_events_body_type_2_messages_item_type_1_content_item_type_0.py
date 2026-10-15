from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType0")


@_attrs_define
class PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType0:
    """
    Attributes:
        type_ (Literal['text']):
        text (str):
        citations (list[Any] | None | Unset):
    """

    type_: Literal["text"]
    text: str
    citations: list[Any] | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        text = self.text

        citations: list[Any] | None | Unset
        if isinstance(self.citations, Unset):
            citations = UNSET
        elif isinstance(self.citations, list):
            citations = self.citations

        else:
            citations = self.citations

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "text": text,
            }
        )
        if citations is not UNSET:
            field_dict["citations"] = citations

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = cast(Literal["text"], d.pop("type"))
        if type_ != "text":
            raise ValueError(f"type must match const 'text', got '{type_}'")

        text = d.pop("text")

        def _parse_citations(data: object) -> list[Any] | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                citations_type_0 = cast(list[Any], data)

                return citations_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[Any] | None | Unset, data)

        citations = _parse_citations(d.pop("citations", UNSET))

        post_api_scenario_events_body_type_2_messages_item_type_1_content_item_type_0 = cls(
            type_=type_,
            text=text,
            citations=citations,
        )

        post_api_scenario_events_body_type_2_messages_item_type_1_content_item_type_0.additional_properties = d
        return post_api_scenario_events_body_type_2_messages_item_type_1_content_item_type_0

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
