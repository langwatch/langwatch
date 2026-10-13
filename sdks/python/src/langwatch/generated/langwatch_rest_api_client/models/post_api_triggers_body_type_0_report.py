from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_triggers_body_type_0_report_schedule import PostApiTriggersBodyType0ReportSchedule
    from ..models.post_api_triggers_body_type_0_report_source_type_0 import PostApiTriggersBodyType0ReportSourceType0
    from ..models.post_api_triggers_body_type_0_report_source_type_1 import PostApiTriggersBodyType0ReportSourceType1
    from ..models.post_api_triggers_body_type_0_report_source_type_2 import PostApiTriggersBodyType0ReportSourceType2


T = TypeVar("T", bound="PostApiTriggersBodyType0Report")


@_attrs_define
class PostApiTriggersBodyType0Report:
    """What a scheduled report renders and when it sends.

    Attributes:
        source (PostApiTriggersBodyType0ReportSourceType0 | PostApiTriggersBodyType0ReportSourceType1 |
            PostApiTriggersBodyType0ReportSourceType2):
        schedule (PostApiTriggersBodyType0ReportSchedule):
        compare_to_previous (bool | Unset):  Default: False.
    """

    source: (
        PostApiTriggersBodyType0ReportSourceType0
        | PostApiTriggersBodyType0ReportSourceType1
        | PostApiTriggersBodyType0ReportSourceType2
    )
    schedule: PostApiTriggersBodyType0ReportSchedule
    compare_to_previous: bool | Unset = False
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_api_triggers_body_type_0_report_source_type_0 import (
            PostApiTriggersBodyType0ReportSourceType0,
        )
        from ..models.post_api_triggers_body_type_0_report_source_type_1 import (
            PostApiTriggersBodyType0ReportSourceType1,
        )

        source: dict[str, Any]
        if isinstance(self.source, PostApiTriggersBodyType0ReportSourceType0):
            source = self.source.to_dict()
        elif isinstance(self.source, PostApiTriggersBodyType0ReportSourceType1):
            source = self.source.to_dict()
        else:
            source = self.source.to_dict()

        schedule = self.schedule.to_dict()

        compare_to_previous = self.compare_to_previous

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "source": source,
                "schedule": schedule,
            }
        )
        if compare_to_previous is not UNSET:
            field_dict["compareToPrevious"] = compare_to_previous

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_triggers_body_type_0_report_schedule import PostApiTriggersBodyType0ReportSchedule
        from ..models.post_api_triggers_body_type_0_report_source_type_0 import (
            PostApiTriggersBodyType0ReportSourceType0,
        )
        from ..models.post_api_triggers_body_type_0_report_source_type_1 import (
            PostApiTriggersBodyType0ReportSourceType1,
        )
        from ..models.post_api_triggers_body_type_0_report_source_type_2 import (
            PostApiTriggersBodyType0ReportSourceType2,
        )

        d = dict(src_dict)

        def _parse_source(
            data: object,
        ) -> (
            PostApiTriggersBodyType0ReportSourceType0
            | PostApiTriggersBodyType0ReportSourceType1
            | PostApiTriggersBodyType0ReportSourceType2
        ):
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                source_type_0 = PostApiTriggersBodyType0ReportSourceType0.from_dict(data)

                return source_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                source_type_1 = PostApiTriggersBodyType0ReportSourceType1.from_dict(data)

                return source_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            source_type_2 = PostApiTriggersBodyType0ReportSourceType2.from_dict(data)

            return source_type_2

        source = _parse_source(d.pop("source"))

        schedule = PostApiTriggersBodyType0ReportSchedule.from_dict(d.pop("schedule"))

        compare_to_previous = d.pop("compareToPrevious", UNSET)

        post_api_triggers_body_type_0_report = cls(
            source=source,
            schedule=schedule,
            compare_to_previous=compare_to_previous,
        )

        post_api_triggers_body_type_0_report.additional_properties = d
        return post_api_triggers_body_type_0_report

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
