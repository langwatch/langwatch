from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="ListWebhookEventsBody")


@_attrs_define
class ListWebhookEventsBody:
    """
    Attributes:
        from_ (int):
        to (int):
        type_ (str | Unset):
        cursor (str | Unset):
        limit (int | Unset):  Default: 50.
    """

    from_: int
    to: int
    type_: str | Unset = UNSET
    cursor: str | Unset = UNSET
    limit: int | Unset = 50
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from_ = self.from_

        to = self.to

        type_ = self.type_

        cursor = self.cursor

        limit = self.limit

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "from": from_,
                "to": to,
            }
        )
        if type_ is not UNSET:
            field_dict["type"] = type_
        if cursor is not UNSET:
            field_dict["cursor"] = cursor
        if limit is not UNSET:
            field_dict["limit"] = limit

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        from_ = d.pop("from")

        to = d.pop("to")

        type_ = d.pop("type", UNSET)

        cursor = d.pop("cursor", UNSET)

        limit = d.pop("limit", UNSET)

        list_webhook_events_body = cls(
            from_=from_,
            to=to,
            type_=type_,
            cursor=cursor,
            limit=limit,
        )

        list_webhook_events_body.additional_properties = d
        return list_webhook_events_body

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
