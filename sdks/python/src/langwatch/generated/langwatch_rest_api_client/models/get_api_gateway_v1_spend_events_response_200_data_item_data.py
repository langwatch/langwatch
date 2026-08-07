from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_gateway_v1_spend_events_response_200_data_item_data_cost_type_0 import (
        GetApiGatewayV1SpendEventsResponse200DataItemDataCostType0,
    )
    from ..models.get_api_gateway_v1_spend_events_response_200_data_item_data_error_type_0 import (
        GetApiGatewayV1SpendEventsResponse200DataItemDataErrorType0,
    )
    from ..models.get_api_gateway_v1_spend_events_response_200_data_item_data_metadata import (
        GetApiGatewayV1SpendEventsResponse200DataItemDataMetadata,
    )
    from ..models.get_api_gateway_v1_spend_events_response_200_data_item_data_usage_type_0 import (
        GetApiGatewayV1SpendEventsResponse200DataItemDataUsageType0,
    )


T = TypeVar("T", bound="GetApiGatewayV1SpendEventsResponse200DataItemData")


@_attrs_define
class GetApiGatewayV1SpendEventsResponse200DataItemData:
    """
    Attributes:
        event_id (str):
        event_type (str):
        gateway_request_id (str):
        occurred_at (str):
        usage (GetApiGatewayV1SpendEventsResponse200DataItemDataUsageType0 | None):
        cost (GetApiGatewayV1SpendEventsResponse200DataItemDataCostType0 | None):
        status (str):
        needs_reconciliation (bool | None):
        settle_reason (None | str):
        error (GetApiGatewayV1SpendEventsResponse200DataItemDataErrorType0 | None):
        duration_ms (int | None):
        labels (list[str]):
        metadata (GetApiGatewayV1SpendEventsResponse200DataItemDataMetadata):
    """

    event_id: str
    event_type: str
    gateway_request_id: str
    occurred_at: str
    usage: GetApiGatewayV1SpendEventsResponse200DataItemDataUsageType0 | None
    cost: GetApiGatewayV1SpendEventsResponse200DataItemDataCostType0 | None
    status: str
    needs_reconciliation: bool | None
    settle_reason: None | str
    error: GetApiGatewayV1SpendEventsResponse200DataItemDataErrorType0 | None
    duration_ms: int | None
    labels: list[str]
    metadata: GetApiGatewayV1SpendEventsResponse200DataItemDataMetadata
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_api_gateway_v1_spend_events_response_200_data_item_data_cost_type_0 import (
            GetApiGatewayV1SpendEventsResponse200DataItemDataCostType0,
        )
        from ..models.get_api_gateway_v1_spend_events_response_200_data_item_data_error_type_0 import (
            GetApiGatewayV1SpendEventsResponse200DataItemDataErrorType0,
        )
        from ..models.get_api_gateway_v1_spend_events_response_200_data_item_data_usage_type_0 import (
            GetApiGatewayV1SpendEventsResponse200DataItemDataUsageType0,
        )

        event_id = self.event_id

        event_type = self.event_type

        gateway_request_id = self.gateway_request_id

        occurred_at = self.occurred_at

        usage: dict[str, Any] | None
        if isinstance(self.usage, GetApiGatewayV1SpendEventsResponse200DataItemDataUsageType0):
            usage = self.usage.to_dict()
        else:
            usage = self.usage

        cost: dict[str, Any] | None
        if isinstance(self.cost, GetApiGatewayV1SpendEventsResponse200DataItemDataCostType0):
            cost = self.cost.to_dict()
        else:
            cost = self.cost

        status = self.status

        needs_reconciliation: bool | None
        needs_reconciliation = self.needs_reconciliation

        settle_reason: None | str
        settle_reason = self.settle_reason

        error: dict[str, Any] | None
        if isinstance(self.error, GetApiGatewayV1SpendEventsResponse200DataItemDataErrorType0):
            error = self.error.to_dict()
        else:
            error = self.error

        duration_ms: int | None
        duration_ms = self.duration_ms

        labels = self.labels

        metadata = self.metadata.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "event_id": event_id,
                "event_type": event_type,
                "gateway_request_id": gateway_request_id,
                "occurred_at": occurred_at,
                "usage": usage,
                "cost": cost,
                "status": status,
                "needs_reconciliation": needs_reconciliation,
                "settle_reason": settle_reason,
                "error": error,
                "duration_ms": duration_ms,
                "labels": labels,
                "metadata": metadata,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_gateway_v1_spend_events_response_200_data_item_data_cost_type_0 import (
            GetApiGatewayV1SpendEventsResponse200DataItemDataCostType0,
        )
        from ..models.get_api_gateway_v1_spend_events_response_200_data_item_data_error_type_0 import (
            GetApiGatewayV1SpendEventsResponse200DataItemDataErrorType0,
        )
        from ..models.get_api_gateway_v1_spend_events_response_200_data_item_data_metadata import (
            GetApiGatewayV1SpendEventsResponse200DataItemDataMetadata,
        )
        from ..models.get_api_gateway_v1_spend_events_response_200_data_item_data_usage_type_0 import (
            GetApiGatewayV1SpendEventsResponse200DataItemDataUsageType0,
        )

        d = dict(src_dict)
        event_id = d.pop("event_id")

        event_type = d.pop("event_type")

        gateway_request_id = d.pop("gateway_request_id")

        occurred_at = d.pop("occurred_at")

        def _parse_usage(data: object) -> GetApiGatewayV1SpendEventsResponse200DataItemDataUsageType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                usage_type_0 = GetApiGatewayV1SpendEventsResponse200DataItemDataUsageType0.from_dict(data)

                return usage_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetApiGatewayV1SpendEventsResponse200DataItemDataUsageType0 | None, data)

        usage = _parse_usage(d.pop("usage"))

        def _parse_cost(data: object) -> GetApiGatewayV1SpendEventsResponse200DataItemDataCostType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                cost_type_0 = GetApiGatewayV1SpendEventsResponse200DataItemDataCostType0.from_dict(data)

                return cost_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetApiGatewayV1SpendEventsResponse200DataItemDataCostType0 | None, data)

        cost = _parse_cost(d.pop("cost"))

        status = d.pop("status")

        def _parse_needs_reconciliation(data: object) -> bool | None:
            if data is None:
                return data
            return cast(bool | None, data)

        needs_reconciliation = _parse_needs_reconciliation(d.pop("needs_reconciliation"))

        def _parse_settle_reason(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        settle_reason = _parse_settle_reason(d.pop("settle_reason"))

        def _parse_error(data: object) -> GetApiGatewayV1SpendEventsResponse200DataItemDataErrorType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                error_type_0 = GetApiGatewayV1SpendEventsResponse200DataItemDataErrorType0.from_dict(data)

                return error_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetApiGatewayV1SpendEventsResponse200DataItemDataErrorType0 | None, data)

        error = _parse_error(d.pop("error"))

        def _parse_duration_ms(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        duration_ms = _parse_duration_ms(d.pop("duration_ms"))

        labels = cast(list[str], d.pop("labels"))

        metadata = GetApiGatewayV1SpendEventsResponse200DataItemDataMetadata.from_dict(d.pop("metadata"))

        get_api_gateway_v1_spend_events_response_200_data_item_data = cls(
            event_id=event_id,
            event_type=event_type,
            gateway_request_id=gateway_request_id,
            occurred_at=occurred_at,
            usage=usage,
            cost=cost,
            status=status,
            needs_reconciliation=needs_reconciliation,
            settle_reason=settle_reason,
            error=error,
            duration_ms=duration_ms,
            labels=labels,
            metadata=metadata,
        )

        get_api_gateway_v1_spend_events_response_200_data_item_data.additional_properties = d
        return get_api_gateway_v1_spend_events_response_200_data_item_data

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
