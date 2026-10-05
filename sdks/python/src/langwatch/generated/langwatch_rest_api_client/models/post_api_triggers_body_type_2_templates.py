from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_triggers_body_type_2_templates_slack_template_type_type_1 import (
    PostApiTriggersBodyType2TemplatesSlackTemplateTypeType1,
)
from ..models.post_api_triggers_body_type_2_templates_slack_template_type_type_2_type_1 import (
    PostApiTriggersBodyType2TemplatesSlackTemplateTypeType2Type1,
)
from ..models.post_api_triggers_body_type_2_templates_slack_template_type_type_3_type_1 import (
    PostApiTriggersBodyType2TemplatesSlackTemplateTypeType3Type1,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiTriggersBodyType2Templates")


@_attrs_define
class PostApiTriggersBodyType2Templates:
    """The Liquid templates this automation's message is rendered from. Absent fields render the LangWatch default for the
    channel.

        Attributes:
            slack_template_type (None | PostApiTriggersBodyType2TemplatesSlackTemplateTypeType1 |
                PostApiTriggersBodyType2TemplatesSlackTemplateTypeType2Type1 |
                PostApiTriggersBodyType2TemplatesSlackTemplateTypeType3Type1 | Unset):
            slack_template (None | str | Unset):
            email_subject_template (None | str | Unset):
            email_body_template (None | str | Unset):
    """

    slack_template_type: (
        None
        | PostApiTriggersBodyType2TemplatesSlackTemplateTypeType1
        | PostApiTriggersBodyType2TemplatesSlackTemplateTypeType2Type1
        | PostApiTriggersBodyType2TemplatesSlackTemplateTypeType3Type1
        | Unset
    ) = UNSET
    slack_template: None | str | Unset = UNSET
    email_subject_template: None | str | Unset = UNSET
    email_body_template: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        slack_template_type: None | str | Unset
        if isinstance(self.slack_template_type, Unset):
            slack_template_type = UNSET
        elif isinstance(self.slack_template_type, PostApiTriggersBodyType2TemplatesSlackTemplateTypeType1):
            slack_template_type = self.slack_template_type.value
        elif isinstance(self.slack_template_type, PostApiTriggersBodyType2TemplatesSlackTemplateTypeType2Type1):
            slack_template_type = self.slack_template_type.value
        elif isinstance(self.slack_template_type, PostApiTriggersBodyType2TemplatesSlackTemplateTypeType3Type1):
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
        field_dict.update(self.additional_properties)
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
        ) -> (
            None
            | PostApiTriggersBodyType2TemplatesSlackTemplateTypeType1
            | PostApiTriggersBodyType2TemplatesSlackTemplateTypeType2Type1
            | PostApiTriggersBodyType2TemplatesSlackTemplateTypeType3Type1
            | Unset
        ):
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                slack_template_type_type_1 = PostApiTriggersBodyType2TemplatesSlackTemplateTypeType1(data)

                return slack_template_type_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                slack_template_type_type_2_type_1 = PostApiTriggersBodyType2TemplatesSlackTemplateTypeType2Type1(data)

                return slack_template_type_type_2_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                slack_template_type_type_3_type_1 = PostApiTriggersBodyType2TemplatesSlackTemplateTypeType3Type1(data)

                return slack_template_type_type_3_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                None
                | PostApiTriggersBodyType2TemplatesSlackTemplateTypeType1
                | PostApiTriggersBodyType2TemplatesSlackTemplateTypeType2Type1
                | PostApiTriggersBodyType2TemplatesSlackTemplateTypeType3Type1
                | Unset,
                data,
            )

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

        post_api_triggers_body_type_2_templates = cls(
            slack_template_type=slack_template_type,
            slack_template=slack_template,
            email_subject_template=email_subject_template,
            email_body_template=email_body_template,
        )

        post_api_triggers_body_type_2_templates.additional_properties = d
        return post_api_triggers_body_type_2_templates

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
