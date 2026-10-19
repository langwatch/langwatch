from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.get_api_triggers_by_id_response_200_action import GetApiTriggersByIdResponse200Action
from ..models.get_api_triggers_by_id_response_200_alert_type_type_0 import GetApiTriggersByIdResponse200AlertTypeType0
from ..models.get_api_triggers_by_id_response_200_kind import GetApiTriggersByIdResponse200Kind

if TYPE_CHECKING:
    from ..models.get_api_triggers_by_id_response_200_action_params import GetApiTriggersByIdResponse200ActionParams
    from ..models.get_api_triggers_by_id_response_200_filters import GetApiTriggersByIdResponse200Filters
    from ..models.get_api_triggers_by_id_response_200_graph_alert_type_0 import (
        GetApiTriggersByIdResponse200GraphAlertType0,
    )
    from ..models.get_api_triggers_by_id_response_200_report_type_0 import GetApiTriggersByIdResponse200ReportType0
    from ..models.get_api_triggers_by_id_response_200_templates import GetApiTriggersByIdResponse200Templates


T = TypeVar("T", bound="GetApiTriggersByIdResponse200")


@_attrs_define
class GetApiTriggersByIdResponse200:
    """
    Attributes:
        id (str):
        name (str):
        action (GetApiTriggersByIdResponse200Action):
        action_params (GetApiTriggersByIdResponse200ActionParams): Where this automation delivers, with every credential
            value replaced by the `[redacted]` placeholder. Which channel is configured, which destination is set and which
            header names are in play all survive; the values never leave; a Slack automation names its connection by
            `slackIntegrationId` and carries no secret. Sending the placeholder back on an update keeps the stored value.
            The rule this automation fires by is not here: it is stated in `graphAlert` or `report`, and sending it in this
            field is refused.
        graph_alert (GetApiTriggersByIdResponse200GraphAlertType0 | None): The rule an alert fires by. Null for anything
            that is not one.
        report (GetApiTriggersByIdResponse200ReportType0 | None): What a report renders and when. Null for anything
            else.
        filters (GetApiTriggersByIdResponse200Filters):
        filter_query (None | str):
        kind (GetApiTriggersByIdResponse200Kind): What this automation is about: matching traces, a metric crossing a
            threshold, or a schedule.
        custom_graph_id (None | str):
        notification_cadence (None | str):
        trace_debounce_ms (float | None):
        templates (GetApiTriggersByIdResponse200Templates): The Liquid templates this automation's message is rendered
            from. Absent fields render the LangWatch default for the channel.
        active (bool):
        message (None | str):
        alert_type (GetApiTriggersByIdResponse200AlertTypeType0 | None):
        created_at (str):
        updated_at (str):
        platform_url (str):
    """

    id: str
    name: str
    action: GetApiTriggersByIdResponse200Action
    action_params: GetApiTriggersByIdResponse200ActionParams
    graph_alert: GetApiTriggersByIdResponse200GraphAlertType0 | None
    report: GetApiTriggersByIdResponse200ReportType0 | None
    filters: GetApiTriggersByIdResponse200Filters
    filter_query: None | str
    kind: GetApiTriggersByIdResponse200Kind
    custom_graph_id: None | str
    notification_cadence: None | str
    trace_debounce_ms: float | None
    templates: GetApiTriggersByIdResponse200Templates
    active: bool
    message: None | str
    alert_type: GetApiTriggersByIdResponse200AlertTypeType0 | None
    created_at: str
    updated_at: str
    platform_url: str

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_api_triggers_by_id_response_200_graph_alert_type_0 import (
            GetApiTriggersByIdResponse200GraphAlertType0,
        )
        from ..models.get_api_triggers_by_id_response_200_report_type_0 import GetApiTriggersByIdResponse200ReportType0

        id = self.id

        name = self.name

        action = self.action.value

        action_params = self.action_params.to_dict()

        graph_alert: dict[str, Any] | None
        if isinstance(self.graph_alert, GetApiTriggersByIdResponse200GraphAlertType0):
            graph_alert = self.graph_alert.to_dict()
        else:
            graph_alert = self.graph_alert

        report: dict[str, Any] | None
        if isinstance(self.report, GetApiTriggersByIdResponse200ReportType0):
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
        if isinstance(self.alert_type, GetApiTriggersByIdResponse200AlertTypeType0):
            alert_type = self.alert_type.value
        else:
            alert_type = self.alert_type

        created_at = self.created_at

        updated_at = self.updated_at

        platform_url = self.platform_url

        field_dict: dict[str, Any] = {}

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
        from ..models.get_api_triggers_by_id_response_200_action_params import GetApiTriggersByIdResponse200ActionParams
        from ..models.get_api_triggers_by_id_response_200_filters import GetApiTriggersByIdResponse200Filters
        from ..models.get_api_triggers_by_id_response_200_graph_alert_type_0 import (
            GetApiTriggersByIdResponse200GraphAlertType0,
        )
        from ..models.get_api_triggers_by_id_response_200_report_type_0 import GetApiTriggersByIdResponse200ReportType0
        from ..models.get_api_triggers_by_id_response_200_templates import GetApiTriggersByIdResponse200Templates

        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        action = GetApiTriggersByIdResponse200Action(d.pop("action"))

        action_params = GetApiTriggersByIdResponse200ActionParams.from_dict(d.pop("actionParams"))

        def _parse_graph_alert(data: object) -> GetApiTriggersByIdResponse200GraphAlertType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                graph_alert_type_0 = GetApiTriggersByIdResponse200GraphAlertType0.from_dict(data)

                return graph_alert_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetApiTriggersByIdResponse200GraphAlertType0 | None, data)

        graph_alert = _parse_graph_alert(d.pop("graphAlert"))

        def _parse_report(data: object) -> GetApiTriggersByIdResponse200ReportType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                report_type_0 = GetApiTriggersByIdResponse200ReportType0.from_dict(data)

                return report_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetApiTriggersByIdResponse200ReportType0 | None, data)

        report = _parse_report(d.pop("report"))

        filters = GetApiTriggersByIdResponse200Filters.from_dict(d.pop("filters"))

        def _parse_filter_query(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        filter_query = _parse_filter_query(d.pop("filterQuery"))

        kind = GetApiTriggersByIdResponse200Kind(d.pop("kind"))

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

        templates = GetApiTriggersByIdResponse200Templates.from_dict(d.pop("templates"))

        active = d.pop("active")

        def _parse_message(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        message = _parse_message(d.pop("message"))

        def _parse_alert_type(data: object) -> GetApiTriggersByIdResponse200AlertTypeType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                alert_type_type_0 = GetApiTriggersByIdResponse200AlertTypeType0(data)

                return alert_type_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetApiTriggersByIdResponse200AlertTypeType0 | None, data)

        alert_type = _parse_alert_type(d.pop("alertType"))

        created_at = d.pop("createdAt")

        updated_at = d.pop("updatedAt")

        platform_url = d.pop("platformUrl")

        get_api_triggers_by_id_response_200 = cls(
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

        return get_api_triggers_by_id_response_200
