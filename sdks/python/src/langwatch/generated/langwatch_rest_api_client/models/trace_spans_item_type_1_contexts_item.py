from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.trace_spans_item_type_1_contexts_item_content_type_1 import (
        TraceSpansItemType1ContextsItemContentType1,
    )


T = TypeVar("T", bound="TraceSpansItemType1ContextsItem")


@_attrs_define
class TraceSpansItemType1ContextsItem:
    """
    Attributes:
        content (list[Any] | str | TraceSpansItemType1ContextsItemContentType1):
        document_id (None | str | Unset):
        chunk_id (None | str | Unset):
    """

    content: list[Any] | str | TraceSpansItemType1ContextsItemContentType1
    document_id: None | str | Unset = UNSET
    chunk_id: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.trace_spans_item_type_1_contexts_item_content_type_1 import (
            TraceSpansItemType1ContextsItemContentType1,
        )

        content: dict[str, Any] | list[Any] | str
        if isinstance(self.content, TraceSpansItemType1ContextsItemContentType1):
            content = self.content.to_dict()
        elif isinstance(self.content, list):
            content = self.content

        else:
            content = self.content

        document_id: None | str | Unset
        if isinstance(self.document_id, Unset):
            document_id = UNSET
        else:
            document_id = self.document_id

        chunk_id: None | str | Unset
        if isinstance(self.chunk_id, Unset):
            chunk_id = UNSET
        else:
            chunk_id = self.chunk_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "content": content,
            }
        )
        if document_id is not UNSET:
            field_dict["document_id"] = document_id
        if chunk_id is not UNSET:
            field_dict["chunk_id"] = chunk_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.trace_spans_item_type_1_contexts_item_content_type_1 import (
            TraceSpansItemType1ContextsItemContentType1,
        )

        d = dict(src_dict)

        def _parse_content(data: object) -> list[Any] | str | TraceSpansItemType1ContextsItemContentType1:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                content_type_1 = TraceSpansItemType1ContextsItemContentType1.from_dict(data)

                return content_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, list):
                    raise TypeError()
                content_type_2 = cast(list[Any], data)

                return content_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[Any] | str | TraceSpansItemType1ContextsItemContentType1, data)

        content = _parse_content(d.pop("content"))

        def _parse_document_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        document_id = _parse_document_id(d.pop("document_id", UNSET))

        def _parse_chunk_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        chunk_id = _parse_chunk_id(d.pop("chunk_id", UNSET))

        trace_spans_item_type_1_contexts_item = cls(
            content=content,
            document_id=document_id,
            chunk_id=chunk_id,
        )

        trace_spans_item_type_1_contexts_item.additional_properties = d
        return trace_spans_item_type_1_contexts_item

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
