from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.get_api_triggers_by_id_response_200_templates_slack_template_type_type_0 import (
    GetApiTriggersByIdResponse200TemplatesSlackTemplateTypeType0,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="GetApiTriggersByIdResponse200Templates")


@_attrs_define
class GetApiTriggersByIdResponse200Templates:
    """The Liquid templates this automation's message is rendered from. Absent fields render the LangWatch default for the
    channel.

        Attributes:
            slack_template_type (GetApiTriggersByIdResponse200TemplatesSlackTemplateTypeType0 | None | Unset):
            slack_template (None | str | Unset):
            email_subject_template (None | str | Unset):
            email_body_template (None | str | Unset):
    """

    slack_template_type: GetApiTriggersByIdResponse200TemplatesSlackTemplateTypeType0 | None | Unset = UNSET
    slack_template: None | str | Unset = UNSET
    email_subject_template: None | str | Unset = UNSET
    email_body_template: None | str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        slack_template_type: None | str | Unset
        if isinstance(self.slack_template_type, Unset):
            slack_template_type = UNSET
        elif isinstance(self.slack_template_type, GetApiTriggersByIdResponse200TemplatesSlackTemplateTypeType0):
            slack_template_type = self.slack_template_type.value
        else:
            slack_template_type = self.slack_template_type

        slack_template: None | str | Unset
        if isinstance(self.slack_template, Unset):
            slack_template = UNSET
        else:
            slack_template = self.slack_template

        email_subject_template: None | str | Unset
        if isinstance(self.email_subject_template, Unset):
            email_subject_template = UNSET
        else:
            email_subject_template = self.email_subject_template

        email_body_template: None | str | Unset
        if isinstance(self.email_body_template, Unset):
            email_body_template = UNSET
        else:
            email_body_template = self.email_body_template

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if slack_template_type is not UNSET:
            field_dict["slackTemplateType"] = slack_template_type
        if slack_template is not UNSET:
            field_dict["slackTemplate"] = slack_template
        if email_subject_template is not UNSET:
            field_dict["emailSubjectTemplate"] = email_subject_template
        if email_body_template is not UNSET:
            field_dict["emailBodyTemplate"] = email_body_template

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)

        def _parse_slack_template_type(
            data: object,
        ) -> GetApiTriggersByIdResponse200TemplatesSlackTemplateTypeType0 | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                slack_template_type_type_0 = GetApiTriggersByIdResponse200TemplatesSlackTemplateTypeType0(data)

                return slack_template_type_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetApiTriggersByIdResponse200TemplatesSlackTemplateTypeType0 | None | Unset, data)

        slack_template_type = _parse_slack_template_type(d.pop("slackTemplateType", UNSET))

        def _parse_slack_template(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        slack_template = _parse_slack_template(d.pop("slackTemplate", UNSET))

        def _parse_email_subject_template(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        email_subject_template = _parse_email_subject_template(d.pop("emailSubjectTemplate", UNSET))

        def _parse_email_body_template(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        email_body_template = _parse_email_body_template(d.pop("emailBodyTemplate", UNSET))

        get_api_triggers_by_id_response_200_templates = cls(
            slack_template_type=slack_template_type,
            slack_template=slack_template,
            email_subject_template=email_subject_template,
            email_body_template=email_body_template,
        )

        return get_api_triggers_by_id_response_200_templates
