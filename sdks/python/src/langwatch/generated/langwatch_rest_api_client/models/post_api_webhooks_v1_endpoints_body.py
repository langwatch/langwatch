from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_webhooks_v1_endpoints_body_destination_kind import PostApiWebhooksV1EndpointsBodyDestinationKind
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_webhooks_v1_endpoints_body_sqs import PostApiWebhooksV1EndpointsBodySqs


T = TypeVar("T", bound="PostApiWebhooksV1EndpointsBody")


@_attrs_define
class PostApiWebhooksV1EndpointsBody:
    """
    Attributes:
        enabled_events (list[str]):
        destination_kind (PostApiWebhooksV1EndpointsBodyDestinationKind | Unset):
        url (str | Unset):
        sqs (PostApiWebhooksV1EndpointsBodySqs | Unset):
        max_batch_size (int | Unset):
        max_batch_delay_ms (int | Unset):
        max_in_flight (int | Unset):
    """

    enabled_events: list[str]
    destination_kind: PostApiWebhooksV1EndpointsBodyDestinationKind | Unset = UNSET
    url: str | Unset = UNSET
    sqs: PostApiWebhooksV1EndpointsBodySqs | Unset = UNSET
    max_batch_size: int | Unset = UNSET
    max_batch_delay_ms: int | Unset = UNSET
    max_in_flight: int | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        enabled_events = self.enabled_events

        destination_kind: str | Unset = UNSET
        if not isinstance(self.destination_kind, Unset):
            destination_kind = self.destination_kind.value

        url = self.url

        sqs: dict[str, Any] | Unset = UNSET
        if not isinstance(self.sqs, Unset):
            sqs = self.sqs.to_dict()

        max_batch_size = self.max_batch_size

        max_batch_delay_ms = self.max_batch_delay_ms

        max_in_flight = self.max_in_flight

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "enabled_events": enabled_events,
            }
        )
        if destination_kind is not UNSET:
            field_dict["destination_kind"] = destination_kind
        if url is not UNSET:
            field_dict["url"] = url
        if sqs is not UNSET:
            field_dict["sqs"] = sqs
        if max_batch_size is not UNSET:
            field_dict["max_batch_size"] = max_batch_size
        if max_batch_delay_ms is not UNSET:
            field_dict["max_batch_delay_ms"] = max_batch_delay_ms
        if max_in_flight is not UNSET:
            field_dict["max_in_flight"] = max_in_flight

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_webhooks_v1_endpoints_body_sqs import PostApiWebhooksV1EndpointsBodySqs

        d = dict(src_dict)
        enabled_events = cast(list[str], d.pop("enabled_events"))

        _destination_kind = d.pop("destination_kind", UNSET)
        destination_kind: PostApiWebhooksV1EndpointsBodyDestinationKind | Unset
        if isinstance(_destination_kind, Unset):
            destination_kind = UNSET
        else:
            destination_kind = PostApiWebhooksV1EndpointsBodyDestinationKind(_destination_kind)

        url = d.pop("url", UNSET)

        _sqs = d.pop("sqs", UNSET)
        sqs: PostApiWebhooksV1EndpointsBodySqs | Unset
        if isinstance(_sqs, Unset):
            sqs = UNSET
        else:
            sqs = PostApiWebhooksV1EndpointsBodySqs.from_dict(_sqs)

        max_batch_size = d.pop("max_batch_size", UNSET)

        max_batch_delay_ms = d.pop("max_batch_delay_ms", UNSET)

        max_in_flight = d.pop("max_in_flight", UNSET)

        post_api_webhooks_v1_endpoints_body = cls(
            enabled_events=enabled_events,
            destination_kind=destination_kind,
            url=url,
            sqs=sqs,
            max_batch_size=max_batch_size,
            max_batch_delay_ms=max_batch_delay_ms,
            max_in_flight=max_in_flight,
        )

        post_api_webhooks_v1_endpoints_body.additional_properties = d
        return post_api_webhooks_v1_endpoints_body

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
