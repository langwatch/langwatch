from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.patch_api_triggers_by_id_body_action import PatchApiTriggersByIdBodyAction
from ..models.patch_api_triggers_by_id_body_alert_type_type_1 import PatchApiTriggersByIdBodyAlertTypeType1
from ..models.patch_api_triggers_by_id_body_alert_type_type_2_type_1 import PatchApiTriggersByIdBodyAlertTypeType2Type1
from ..models.patch_api_triggers_by_id_body_alert_type_type_3_type_1 import PatchApiTriggersByIdBodyAlertTypeType3Type1
from ..models.patch_api_triggers_by_id_body_notification_cadence import PatchApiTriggersByIdBodyNotificationCadence
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.patch_api_triggers_by_id_body_action_params_type_0 import PatchApiTriggersByIdBodyActionParamsType0
    from ..models.patch_api_triggers_by_id_body_action_params_type_1 import PatchApiTriggersByIdBodyActionParamsType1
    from ..models.patch_api_triggers_by_id_body_action_params_type_2 import PatchApiTriggersByIdBodyActionParamsType2
    from ..models.patch_api_triggers_by_id_body_action_params_type_3 import PatchApiTriggersByIdBodyActionParamsType3
    from ..models.patch_api_triggers_by_id_body_action_params_type_4 import PatchApiTriggersByIdBodyActionParamsType4
    from ..models.patch_api_triggers_by_id_body_filters import PatchApiTriggersByIdBodyFilters
    from ..models.patch_api_triggers_by_id_body_graph_alert import PatchApiTriggersByIdBodyGraphAlert
    from ..models.patch_api_triggers_by_id_body_report import PatchApiTriggersByIdBodyReport
    from ..models.patch_api_triggers_by_id_body_templates import PatchApiTriggersByIdBodyTemplates


T = TypeVar("T", bound="PatchApiTriggersByIdBody")


@_attrs_define
class PatchApiTriggersByIdBody:
    """
    Attributes:
        name (str | Unset):
        active (bool | Unset):
        message (None | str | Unset):
        alert_type (None | PatchApiTriggersByIdBodyAlertTypeType1 | PatchApiTriggersByIdBodyAlertTypeType2Type1 |
            PatchApiTriggersByIdBodyAlertTypeType3Type1 | Unset):
        filters (PatchApiTriggersByIdBodyFilters | Unset):
        filter_query (None | str | Unset): The trace query this automation is about, in the syntax the traces view uses.
            When set it supersedes `filters`.
        action (PatchApiTriggersByIdBodyAction | Unset):
        action_params (PatchApiTriggersByIdBodyActionParamsType0 | PatchApiTriggersByIdBodyActionParamsType1 |
            PatchApiTriggersByIdBodyActionParamsType2 | PatchApiTriggersByIdBodyActionParamsType3 |
            PatchApiTriggersByIdBodyActionParamsType4 | Unset): Replaces the delivery configuration as a whole rather than
            merging into it: send the fields this automation should have from now on, and anything left out is removed —
            omit `headers` and it delivers with none, omit `signingSecret` and its deliveries are no longer signed. The one
            exception is a credential the read hid: send back the `[redacted]` placeholder and the stored credential is kept
            (a Slack automation not yet on a connection has its stored secret moved into one), so reading an automation,
            changing one field and writing the whole object back is safe. Only this channel's fields are accepted; anything
            else is refused rather than dropped, and the rule this automation fires by belongs in `graphAlert` or `report`.
        graph_alert (PatchApiTriggersByIdBodyGraphAlert | Unset): The rule this alert fires by. Only for an automation
            that is one.
        report (PatchApiTriggersByIdBodyReport | Unset): What this report renders and when. Only for one that is a
            report.
        templates (PatchApiTriggersByIdBodyTemplates | Unset): The Liquid templates this automation's message is
            rendered from. Absent fields render the LangWatch default for the channel.
        notification_cadence (PatchApiTriggersByIdBodyNotificationCadence | Unset): How often a notification automation
            is allowed to send. A new one starts on a five-minute digest, which is what keeps a broad condition from sending
            a message per matching trace.
        trace_debounce_ms (int | Unset): How long to wait for a trace to settle before the conditions are read.
    """

    name: str | Unset = UNSET
    active: bool | Unset = UNSET
    message: None | str | Unset = UNSET
    alert_type: (
        None
        | PatchApiTriggersByIdBodyAlertTypeType1
        | PatchApiTriggersByIdBodyAlertTypeType2Type1
        | PatchApiTriggersByIdBodyAlertTypeType3Type1
        | Unset
    ) = UNSET
    filters: PatchApiTriggersByIdBodyFilters | Unset = UNSET
    filter_query: None | str | Unset = UNSET
    action: PatchApiTriggersByIdBodyAction | Unset = UNSET
    action_params: (
        PatchApiTriggersByIdBodyActionParamsType0
        | PatchApiTriggersByIdBodyActionParamsType1
        | PatchApiTriggersByIdBodyActionParamsType2
        | PatchApiTriggersByIdBodyActionParamsType3
        | PatchApiTriggersByIdBodyActionParamsType4
        | Unset
    ) = UNSET
    graph_alert: PatchApiTriggersByIdBodyGraphAlert | Unset = UNSET
    report: PatchApiTriggersByIdBodyReport | Unset = UNSET
    templates: PatchApiTriggersByIdBodyTemplates | Unset = UNSET
    notification_cadence: PatchApiTriggersByIdBodyNotificationCadence | Unset = UNSET
    trace_debounce_ms: int | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.patch_api_triggers_by_id_body_action_params_type_0 import (
            PatchApiTriggersByIdBodyActionParamsType0,
        )
        from ..models.patch_api_triggers_by_id_body_action_params_type_1 import (
            PatchApiTriggersByIdBodyActionParamsType1,
        )
        from ..models.patch_api_triggers_by_id_body_action_params_type_2 import (
            PatchApiTriggersByIdBodyActionParamsType2,
        )
        from ..models.patch_api_triggers_by_id_body_action_params_type_3 import (
            PatchApiTriggersByIdBodyActionParamsType3,
        )

        name = self.name

        active = self.active

        message: None | str | Unset
        if isinstance(self.message, Unset):
            message = UNSET
        else:
            message = self.message

        alert_type: None | str | Unset
        if isinstance(self.alert_type, Unset):
            alert_type = UNSET
        elif isinstance(self.alert_type, PatchApiTriggersByIdBodyAlertTypeType1):
            alert_type = self.alert_type.value
        elif isinstance(self.alert_type, PatchApiTriggersByIdBodyAlertTypeType2Type1):
            alert_type = self.alert_type.value
        elif isinstance(self.alert_type, PatchApiTriggersByIdBodyAlertTypeType3Type1):
            alert_type = self.alert_type.value
        else:
            alert_type = self.alert_type

        filters: dict[str, Any] | Unset = UNSET
        if not isinstance(self.filters, Unset):
            filters = self.filters.to_dict()

        filter_query: None | str | Unset
        if isinstance(self.filter_query, Unset):
            filter_query = UNSET
        else:
            filter_query = self.filter_query

        action: str | Unset = UNSET
        if not isinstance(self.action, Unset):
            action = self.action.value

        action_params: dict[str, Any] | Unset
        if isinstance(self.action_params, Unset):
            action_params = UNSET
        elif isinstance(self.action_params, PatchApiTriggersByIdBodyActionParamsType0):
            action_params = self.action_params.to_dict()
        elif isinstance(self.action_params, PatchApiTriggersByIdBodyActionParamsType1):
            action_params = self.action_params.to_dict()
        elif isinstance(self.action_params, PatchApiTriggersByIdBodyActionParamsType2):
            action_params = self.action_params.to_dict()
        elif isinstance(self.action_params, PatchApiTriggersByIdBodyActionParamsType3):
            action_params = self.action_params.to_dict()
        else:
            action_params = self.action_params.to_dict()

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
        field_dict.update({})
        if name is not UNSET:
            field_dict["name"] = name
        if active is not UNSET:
            field_dict["active"] = active
        if message is not UNSET:
            field_dict["message"] = message
        if alert_type is not UNSET:
            field_dict["alertType"] = alert_type
        if filters is not UNSET:
            field_dict["filters"] = filters
        if filter_query is not UNSET:
            field_dict["filterQuery"] = filter_query
        if action is not UNSET:
            field_dict["action"] = action
        if action_params is not UNSET:
            field_dict["actionParams"] = action_params
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
        from ..models.patch_api_triggers_by_id_body_action_params_type_0 import (
            PatchApiTriggersByIdBodyActionParamsType0,
        )
        from ..models.patch_api_triggers_by_id_body_action_params_type_1 import (
            PatchApiTriggersByIdBodyActionParamsType1,
        )
        from ..models.patch_api_triggers_by_id_body_action_params_type_2 import (
            PatchApiTriggersByIdBodyActionParamsType2,
        )
        from ..models.patch_api_triggers_by_id_body_action_params_type_3 import (
            PatchApiTriggersByIdBodyActionParamsType3,
        )
        from ..models.patch_api_triggers_by_id_body_action_params_type_4 import (
            PatchApiTriggersByIdBodyActionParamsType4,
        )
        from ..models.patch_api_triggers_by_id_body_filters import PatchApiTriggersByIdBodyFilters
        from ..models.patch_api_triggers_by_id_body_graph_alert import PatchApiTriggersByIdBodyGraphAlert
        from ..models.patch_api_triggers_by_id_body_report import PatchApiTriggersByIdBodyReport
        from ..models.patch_api_triggers_by_id_body_templates import PatchApiTriggersByIdBodyTemplates

        d = dict(src_dict)
        name = d.pop("name", UNSET)

        active = d.pop("active", UNSET)

        def _parse_message(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        message = _parse_message(d.pop("message", UNSET))

        def _parse_alert_type(
            data: object,
        ) -> (
            None
            | PatchApiTriggersByIdBodyAlertTypeType1
            | PatchApiTriggersByIdBodyAlertTypeType2Type1
            | PatchApiTriggersByIdBodyAlertTypeType3Type1
            | Unset
        ):
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                alert_type_type_1 = PatchApiTriggersByIdBodyAlertTypeType1(data)

                return alert_type_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                alert_type_type_2_type_1 = PatchApiTriggersByIdBodyAlertTypeType2Type1(data)

                return alert_type_type_2_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                alert_type_type_3_type_1 = PatchApiTriggersByIdBodyAlertTypeType3Type1(data)

                return alert_type_type_3_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                None
                | PatchApiTriggersByIdBodyAlertTypeType1
                | PatchApiTriggersByIdBodyAlertTypeType2Type1
                | PatchApiTriggersByIdBodyAlertTypeType3Type1
                | Unset,
                data,
            )

        alert_type = _parse_alert_type(d.pop("alertType", UNSET))

        _filters = d.pop("filters", UNSET)
        filters: PatchApiTriggersByIdBodyFilters | Unset
        if isinstance(_filters, Unset):
            filters = UNSET
        else:
            filters = PatchApiTriggersByIdBodyFilters.from_dict(_filters)

        def _parse_filter_query(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        filter_query = _parse_filter_query(d.pop("filterQuery", UNSET))

        _action = d.pop("action", UNSET)
        action: PatchApiTriggersByIdBodyAction | Unset
        if isinstance(_action, Unset):
            action = UNSET
        else:
            action = PatchApiTriggersByIdBodyAction(_action)

        def _parse_action_params(
            data: object,
        ) -> (
            PatchApiTriggersByIdBodyActionParamsType0
            | PatchApiTriggersByIdBodyActionParamsType1
            | PatchApiTriggersByIdBodyActionParamsType2
            | PatchApiTriggersByIdBodyActionParamsType3
            | PatchApiTriggersByIdBodyActionParamsType4
            | Unset
        ):
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                action_params_type_0 = PatchApiTriggersByIdBodyActionParamsType0.from_dict(data)

                return action_params_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                action_params_type_1 = PatchApiTriggersByIdBodyActionParamsType1.from_dict(data)

                return action_params_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                action_params_type_2 = PatchApiTriggersByIdBodyActionParamsType2.from_dict(data)

                return action_params_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                action_params_type_3 = PatchApiTriggersByIdBodyActionParamsType3.from_dict(data)

                return action_params_type_3
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            action_params_type_4 = PatchApiTriggersByIdBodyActionParamsType4.from_dict(data)

            return action_params_type_4

        action_params = _parse_action_params(d.pop("actionParams", UNSET))

        _graph_alert = d.pop("graphAlert", UNSET)
        graph_alert: PatchApiTriggersByIdBodyGraphAlert | Unset
        if isinstance(_graph_alert, Unset):
            graph_alert = UNSET
        else:
            graph_alert = PatchApiTriggersByIdBodyGraphAlert.from_dict(_graph_alert)

        _report = d.pop("report", UNSET)
        report: PatchApiTriggersByIdBodyReport | Unset
        if isinstance(_report, Unset):
            report = UNSET
        else:
            report = PatchApiTriggersByIdBodyReport.from_dict(_report)

        _templates = d.pop("templates", UNSET)
        templates: PatchApiTriggersByIdBodyTemplates | Unset
        if isinstance(_templates, Unset):
            templates = UNSET
        else:
            templates = PatchApiTriggersByIdBodyTemplates.from_dict(_templates)

        _notification_cadence = d.pop("notificationCadence", UNSET)
        notification_cadence: PatchApiTriggersByIdBodyNotificationCadence | Unset
        if isinstance(_notification_cadence, Unset):
            notification_cadence = UNSET
        else:
            notification_cadence = PatchApiTriggersByIdBodyNotificationCadence(_notification_cadence)

        trace_debounce_ms = d.pop("traceDebounceMs", UNSET)

        patch_api_triggers_by_id_body = cls(
            name=name,
            active=active,
            message=message,
            alert_type=alert_type,
            filters=filters,
            filter_query=filter_query,
            action=action,
            action_params=action_params,
            graph_alert=graph_alert,
            report=report,
            templates=templates,
            notification_cadence=notification_cadence,
            trace_debounce_ms=trace_debounce_ms,
        )

        patch_api_triggers_by_id_body.additional_properties = d
        return patch_api_triggers_by_id_body

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
