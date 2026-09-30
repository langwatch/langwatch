from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_triggers_body_type_1_alert_type import PostApiTriggersBodyType1AlertType
from ..models.post_api_triggers_body_type_1_notification_cadence import PostApiTriggersBodyType1NotificationCadence
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_triggers_body_type_1_action_params import PostApiTriggersBodyType1ActionParams
    from ..models.post_api_triggers_body_type_1_filters import PostApiTriggersBodyType1Filters
    from ..models.post_api_triggers_body_type_1_graph_alert import PostApiTriggersBodyType1GraphAlert
    from ..models.post_api_triggers_body_type_1_report import PostApiTriggersBodyType1Report
    from ..models.post_api_triggers_body_type_1_templates import PostApiTriggersBodyType1Templates


T = TypeVar("T", bound="PostApiTriggersBodyType1")


@_attrs_define
class PostApiTriggersBodyType1:
    """
    Attributes:
        action (Literal['SEND_SLACK_MESSAGE']):
        action_params (PostApiTriggersBodyType1ActionParams): Slack delivery through a Slack connection
            (`slackIntegrationId`), plus `slackChannelId` when the connection is a bot.
        name (str):
        filters (PostApiTriggersBodyType1Filters | Unset):
        filter_query (None | str | Unset): The trace query this automation is about, in the syntax the traces view uses.
            When set it supersedes `filters`.
        message (str | Unset):
        alert_type (PostApiTriggersBodyType1AlertType | Unset):
        custom_graph_id (str | Unset): Set to make this an alert on that graph. `graphAlert` and `alertType` are then
            required.
        graph_alert (PostApiTriggersBodyType1GraphAlert | Unset): The rule an alert fires by: series, operator,
            threshold, window.
        report (PostApiTriggersBodyType1Report | Unset): What a scheduled report renders and when it sends.
        templates (PostApiTriggersBodyType1Templates | Unset): The Liquid templates this automation's message is
            rendered from. Absent fields render the LangWatch default for the channel.
        notification_cadence (PostApiTriggersBodyType1NotificationCadence | Unset): How often a notification automation
            is allowed to send. A new one starts on a five-minute digest, which is what keeps a broad condition from sending
            a message per matching trace.
        trace_debounce_ms (int | Unset): How long to wait for a trace to settle before the conditions are read.
    """

    action: Literal["SEND_SLACK_MESSAGE"]
    action_params: PostApiTriggersBodyType1ActionParams
    name: str
    filters: PostApiTriggersBodyType1Filters | Unset = UNSET
    filter_query: None | str | Unset = UNSET
    message: str | Unset = UNSET
    alert_type: PostApiTriggersBodyType1AlertType | Unset = UNSET
    custom_graph_id: str | Unset = UNSET
    graph_alert: PostApiTriggersBodyType1GraphAlert | Unset = UNSET
    report: PostApiTriggersBodyType1Report | Unset = UNSET
    templates: PostApiTriggersBodyType1Templates | Unset = UNSET
    notification_cadence: PostApiTriggersBodyType1NotificationCadence | Unset = UNSET
    trace_debounce_ms: int | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        action = self.action

        action_params = self.action_params.to_dict()

        name = self.name

        filters: dict[str, Any] | Unset = UNSET
        if not isinstance(self.filters, Unset):
            filters = self.filters.to_dict()

        filter_query: None | str | Unset
        if isinstance(self.filter_query, Unset):
            filter_query = UNSET
        else:
            filter_query = self.filter_query

        message = self.message

        alert_type: str | Unset = UNSET
        if not isinstance(self.alert_type, Unset):
            alert_type = self.alert_type.value

        custom_graph_id = self.custom_graph_id

        graph_alert: dict[str, Any] | Unset = UNSET
        if not isinstance(self.graph_alert, Unset):
            graph_alert = self.graph_alert.to_dict()

        report: dict[str, Any] | Unset = UNSET
        if not isinstance(self.report, Unset):
            report = self.report.to_dict()

        templates: dict[str, Any] | Unset = UNSET
        if not isinstance(self.templates, Unset):
            templates = self.templates.to_dict()

        notification_cadence: str | Unset = UNSET
        if not isinstance(self.notification_cadence, Unset):
            notification_cadence = self.notification_cadence.value

        trace_debounce_ms = self.trace_debounce_ms

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "action": action,
                "actionParams": action_params,
                "name": name,
            }
        )
        if filters is not UNSET:
            field_dict["filters"] = filters
        if filter_query is not UNSET:
            field_dict["filterQuery"] = filter_query
        if message is not UNSET:
            field_dict["message"] = message
        if alert_type is not UNSET:
            field_dict["alertType"] = alert_type
        if custom_graph_id is not UNSET:
            field_dict["customGraphId"] = custom_graph_id
        if graph_alert is not UNSET:
            field_dict["graphAlert"] = graph_alert
        if report is not UNSET:
            field_dict["report"] = report
        if templates is not UNSET:
            field_dict["templates"] = templates
        if notification_cadence is not UNSET:
            field_dict["notificationCadence"] = notification_cadence
        if trace_debounce_ms is not UNSET:
            field_dict["traceDebounceMs"] = trace_debounce_ms

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_triggers_body_type_1_action_params import PostApiTriggersBodyType1ActionParams
        from ..models.post_api_triggers_body_type_1_filters import PostApiTriggersBodyType1Filters
        from ..models.post_api_triggers_body_type_1_graph_alert import PostApiTriggersBodyType1GraphAlert
        from ..models.post_api_triggers_body_type_1_report import PostApiTriggersBodyType1Report
        from ..models.post_api_triggers_body_type_1_templates import PostApiTriggersBodyType1Templates

        d = dict(src_dict)
        action = cast(Literal["SEND_SLACK_MESSAGE"], d.pop("action"))
        if action != "SEND_SLACK_MESSAGE":
            raise ValueError(f"action must match const 'SEND_SLACK_MESSAGE', got '{action}'")

        action_params = PostApiTriggersBodyType1ActionParams.from_dict(d.pop("actionParams"))

        name = d.pop("name")

        _filters = d.pop("filters", UNSET)
        filters: PostApiTriggersBodyType1Filters | Unset
        if isinstance(_filters, Unset):
            filters = UNSET
        else:
            filters = PostApiTriggersBodyType1Filters.from_dict(_filters)

        def _parse_filter_query(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        filter_query = _parse_filter_query(d.pop("filterQuery", UNSET))

        message = d.pop("message", UNSET)

        _alert_type = d.pop("alertType", UNSET)
        alert_type: PostApiTriggersBodyType1AlertType | Unset
        if isinstance(_alert_type, Unset):
            alert_type = UNSET
        else:
            alert_type = PostApiTriggersBodyType1AlertType(_alert_type)

        custom_graph_id = d.pop("customGraphId", UNSET)

        _graph_alert = d.pop("graphAlert", UNSET)
        graph_alert: PostApiTriggersBodyType1GraphAlert | Unset
        if isinstance(_graph_alert, Unset):
            graph_alert = UNSET
        else:
            graph_alert = PostApiTriggersBodyType1GraphAlert.from_dict(_graph_alert)

        _report = d.pop("report", UNSET)
        report: PostApiTriggersBodyType1Report | Unset
        if isinstance(_report, Unset):
            report = UNSET
        else:
            report = PostApiTriggersBodyType1Report.from_dict(_report)

        _templates = d.pop("templates", UNSET)
        templates: PostApiTriggersBodyType1Templates | Unset
        if isinstance(_templates, Unset):
            templates = UNSET
        else:
            templates = PostApiTriggersBodyType1Templates.from_dict(_templates)

        _notification_cadence = d.pop("notificationCadence", UNSET)
        notification_cadence: PostApiTriggersBodyType1NotificationCadence | Unset
        if isinstance(_notification_cadence, Unset):
            notification_cadence = UNSET
        else:
            notification_cadence = PostApiTriggersBodyType1NotificationCadence(_notification_cadence)

        trace_debounce_ms = d.pop("traceDebounceMs", UNSET)

        post_api_triggers_body_type_1 = cls(
            action=action,
            action_params=action_params,
            name=name,
            filters=filters,
            filter_query=filter_query,
            message=message,
            alert_type=alert_type,
            custom_graph_id=custom_graph_id,
            graph_alert=graph_alert,
            report=report,
            templates=templates,
            notification_cadence=notification_cadence,
            trace_debounce_ms=trace_debounce_ms,
        )

        post_api_triggers_body_type_1.additional_properties = d
        return post_api_triggers_body_type_1

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
