from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_api_triggers_response_200_item_action import GetApiTriggersResponse200ItemAction
from ..models.get_api_triggers_response_200_item_alert_type_type_1 import GetApiTriggersResponse200ItemAlertTypeType1
from ..models.get_api_triggers_response_200_item_alert_type_type_2_type_1 import (
    GetApiTriggersResponse200ItemAlertTypeType2Type1,
)
from ..models.get_api_triggers_response_200_item_alert_type_type_3_type_1 import (
    GetApiTriggersResponse200ItemAlertTypeType3Type1,
)
from ..models.get_api_triggers_response_200_item_kind import GetApiTriggersResponse200ItemKind

if TYPE_CHECKING:
    from ..models.get_api_triggers_response_200_item_action_params import GetApiTriggersResponse200ItemActionParams
    from ..models.get_api_triggers_response_200_item_filters import GetApiTriggersResponse200ItemFilters
    from ..models.get_api_triggers_response_200_item_graph_alert_type_0 import (
        GetApiTriggersResponse200ItemGraphAlertType0,
    )
    from ..models.get_api_triggers_response_200_item_report_type_0 import GetApiTriggersResponse200ItemReportType0
    from ..models.get_api_triggers_response_200_item_templates import GetApiTriggersResponse200ItemTemplates


T = TypeVar("T", bound="GetApiTriggersResponse200Item")


@_attrs_define
class GetApiTriggersResponse200Item:
    """
    Attributes:
        id (str):
        name (str):
        action (GetApiTriggersResponse200ItemAction):
        action_params (GetApiTriggersResponse200ItemActionParams): Where this automation delivers, with every credential
            value replaced by the `[redacted]` placeholder. Which channel is configured, which destination is set and which
            header names are in play all survive; the values never leave; a Slack automation names its connection by
            `slackIntegrationId` and carries no secret. Sending the placeholder back on an update keeps the stored value.
            The rule this automation fires by is not here — it is stated in `graphAlert` or `report`, and sending it in this
            field is refused.
        graph_alert (GetApiTriggersResponse200ItemGraphAlertType0 | None): The rule an alert fires by. Null for anything
            that is not one.
        report (GetApiTriggersResponse200ItemReportType0 | None): What a report renders and when. Null for anything
            else.
        filters (GetApiTriggersResponse200ItemFilters):
        filter_query (None | str):
        kind (GetApiTriggersResponse200ItemKind): What this automation is about: matching traces, a metric crossing a
            threshold, or a schedule.
        custom_graph_id (None | str):
        notification_cadence (None | str):
        trace_debounce_ms (float | None):
        templates (GetApiTriggersResponse200ItemTemplates): The Liquid templates this automation's message is rendered
            from. Absent fields render the LangWatch default for the channel.
        active (bool):
        message (None | str):
        alert_type (GetApiTriggersResponse200ItemAlertTypeType1 | GetApiTriggersResponse200ItemAlertTypeType2Type1 |
            GetApiTriggersResponse200ItemAlertTypeType3Type1 | None):
        created_at (str):
        updated_at (str):
        platform_url (str):
    """

    id: str
    name: str
    action: GetApiTriggersResponse200ItemAction
    action_params: GetApiTriggersResponse200ItemActionParams
    graph_alert: GetApiTriggersResponse200ItemGraphAlertType0 | None
    report: GetApiTriggersResponse200ItemReportType0 | None
    filters: GetApiTriggersResponse200ItemFilters
    filter_query: None | str
    kind: GetApiTriggersResponse200ItemKind
    custom_graph_id: None | str
    notification_cadence: None | str
    trace_debounce_ms: float | None
    templates: GetApiTriggersResponse200ItemTemplates
    active: bool
    message: None | str
    alert_type: (
        GetApiTriggersResponse200ItemAlertTypeType1
        | GetApiTriggersResponse200ItemAlertTypeType2Type1
        | GetApiTriggersResponse200ItemAlertTypeType3Type1
        | None
    )
    created_at: str
    updated_at: str
    platform_url: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_api_triggers_response_200_item_graph_alert_type_0 import (
            GetApiTriggersResponse200ItemGraphAlertType0,
        )
        from ..models.get_api_triggers_response_200_item_report_type_0 import GetApiTriggersResponse200ItemReportType0

        id = self.id

        name = self.name

        action = self.action.value

        action_params = self.action_params.to_dict()

        graph_alert: dict[str, Any] | None
        if isinstance(self.graph_alert, GetApiTriggersResponse200ItemGraphAlertType0):
            graph_alert = self.graph_alert.to_dict()
        else:
            graph_alert = self.graph_alert

        report: dict[str, Any] | None
        if isinstance(self.report, GetApiTriggersResponse200ItemReportType0):
            report = self.report.to_dict()
        else:
            report = self.report

        filters = self.filters.to_dict()

        filter_query: None | str
        filter_query = self.filter_query

        kind = self.kind.value

        custom_graph_id: None | str
        custom_graph_id = self.custom_graph_id

        notification_cadence: None | str
        notification_cadence = self.notification_cadence

        trace_debounce_ms: float | None
        trace_debounce_ms = self.trace_debounce_ms

        templates = self.templates.to_dict()

        active = self.active

        message: None | str
        message = self.message

        alert_type: None | str
        if isinstance(self.alert_type, GetApiTriggersResponse200ItemAlertTypeType1):
            alert_type = self.alert_type.value
        elif isinstance(self.alert_type, GetApiTriggersResponse200ItemAlertTypeType2Type1):
            alert_type = self.alert_type.value
        elif isinstance(self.alert_type, GetApiTriggersResponse200ItemAlertTypeType3Type1):
            alert_type = self.alert_type.value
        else:
            alert_type = self.alert_type

        created_at = self.created_at

        updated_at = self.updated_at

        platform_url = self.platform_url

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "name": name,
                "action": action,
                "actionParams": action_params,
                "graphAlert": graph_alert,
                "report": report,
                "filters": filters,
                "filterQuery": filter_query,
                "kind": kind,
                "customGraphId": custom_graph_id,
                "notificationCadence": notification_cadence,
                "traceDebounceMs": trace_debounce_ms,
                "templates": templates,
                "active": active,
                "message": message,
                "alertType": alert_type,
                "createdAt": created_at,
                "updatedAt": updated_at,
                "platformUrl": platform_url,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_triggers_response_200_item_action_params import GetApiTriggersResponse200ItemActionParams
        from ..models.get_api_triggers_response_200_item_filters import GetApiTriggersResponse200ItemFilters
        from ..models.get_api_triggers_response_200_item_graph_alert_type_0 import (
            GetApiTriggersResponse200ItemGraphAlertType0,
        )
        from ..models.get_api_triggers_response_200_item_report_type_0 import GetApiTriggersResponse200ItemReportType0
        from ..models.get_api_triggers_response_200_item_templates import GetApiTriggersResponse200ItemTemplates

        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        action = GetApiTriggersResponse200ItemAction(d.pop("action"))

        action_params = GetApiTriggersResponse200ItemActionParams.from_dict(d.pop("actionParams"))

        def _parse_graph_alert(data: object) -> GetApiTriggersResponse200ItemGraphAlertType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                graph_alert_type_0 = GetApiTriggersResponse200ItemGraphAlertType0.from_dict(data)

                return graph_alert_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetApiTriggersResponse200ItemGraphAlertType0 | None, data)

        graph_alert = _parse_graph_alert(d.pop("graphAlert"))

        def _parse_report(data: object) -> GetApiTriggersResponse200ItemReportType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                report_type_0 = GetApiTriggersResponse200ItemReportType0.from_dict(data)

                return report_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetApiTriggersResponse200ItemReportType0 | None, data)

        report = _parse_report(d.pop("report"))

        filters = GetApiTriggersResponse200ItemFilters.from_dict(d.pop("filters"))

        def _parse_filter_query(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        filter_query = _parse_filter_query(d.pop("filterQuery"))

        kind = GetApiTriggersResponse200ItemKind(d.pop("kind"))

        def _parse_custom_graph_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        custom_graph_id = _parse_custom_graph_id(d.pop("customGraphId"))

        def _parse_notification_cadence(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        notification_cadence = _parse_notification_cadence(d.pop("notificationCadence"))

        def _parse_trace_debounce_ms(data: object) -> float | None:
            if data is None:
                return data
            return cast(float | None, data)

        trace_debounce_ms = _parse_trace_debounce_ms(d.pop("traceDebounceMs"))

        templates = GetApiTriggersResponse200ItemTemplates.from_dict(d.pop("templates"))

        active = d.pop("active")

        def _parse_message(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        message = _parse_message(d.pop("message"))

        def _parse_alert_type(
            data: object,
        ) -> (
            GetApiTriggersResponse200ItemAlertTypeType1
            | GetApiTriggersResponse200ItemAlertTypeType2Type1
            | GetApiTriggersResponse200ItemAlertTypeType3Type1
            | None
        ):
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                alert_type_type_1 = GetApiTriggersResponse200ItemAlertTypeType1(data)

                return alert_type_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                alert_type_type_2_type_1 = GetApiTriggersResponse200ItemAlertTypeType2Type1(data)

                return alert_type_type_2_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                alert_type_type_3_type_1 = GetApiTriggersResponse200ItemAlertTypeType3Type1(data)

                return alert_type_type_3_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                GetApiTriggersResponse200ItemAlertTypeType1
                | GetApiTriggersResponse200ItemAlertTypeType2Type1
                | GetApiTriggersResponse200ItemAlertTypeType3Type1
                | None,
                data,
            )

        alert_type = _parse_alert_type(d.pop("alertType"))

        created_at = d.pop("createdAt")

        updated_at = d.pop("updatedAt")

        platform_url = d.pop("platformUrl")

        get_api_triggers_response_200_item = cls(
            id=id,
            name=name,
            action=action,
            action_params=action_params,
            graph_alert=graph_alert,
            report=report,
            filters=filters,
            filter_query=filter_query,
            kind=kind,
            custom_graph_id=custom_graph_id,
            notification_cadence=notification_cadence,
            trace_debounce_ms=trace_debounce_ms,
            templates=templates,
            active=active,
            message=message,
            alert_type=alert_type,
            created_at=created_at,
            updated_at=updated_at,
            platform_url=platform_url,
        )

        get_api_triggers_response_200_item.additional_properties = d
        return get_api_triggers_response_200_item

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
