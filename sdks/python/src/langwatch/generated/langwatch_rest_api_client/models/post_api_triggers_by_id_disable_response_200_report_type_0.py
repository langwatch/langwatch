from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_api_triggers_by_id_disable_response_200_report_type_0_schedule import (
        PostApiTriggersByIdDisableResponse200ReportType0Schedule,
    )
    from ..models.post_api_triggers_by_id_disable_response_200_report_type_0_source_type_0 import (
        PostApiTriggersByIdDisableResponse200ReportType0SourceType0,
    )
    from ..models.post_api_triggers_by_id_disable_response_200_report_type_0_source_type_1 import (
        PostApiTriggersByIdDisableResponse200ReportType0SourceType1,
    )
    from ..models.post_api_triggers_by_id_disable_response_200_report_type_0_source_type_2 import (
        PostApiTriggersByIdDisableResponse200ReportType0SourceType2,
    )


T = TypeVar("T", bound="PostApiTriggersByIdDisableResponse200ReportType0")


@_attrs_define
class PostApiTriggersByIdDisableResponse200ReportType0:
    """
    Attributes:
        source (PostApiTriggersByIdDisableResponse200ReportType0SourceType0 |
            PostApiTriggersByIdDisableResponse200ReportType0SourceType1 |
            PostApiTriggersByIdDisableResponse200ReportType0SourceType2):
        schedule (PostApiTriggersByIdDisableResponse200ReportType0Schedule):
        compare_to_previous (bool):  Default: False.
    """

    source: (
        PostApiTriggersByIdDisableResponse200ReportType0SourceType0
        | PostApiTriggersByIdDisableResponse200ReportType0SourceType1
        | PostApiTriggersByIdDisableResponse200ReportType0SourceType2
    )
    schedule: PostApiTriggersByIdDisableResponse200ReportType0Schedule
    compare_to_previous: bool = False

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_api_triggers_by_id_disable_response_200_report_type_0_source_type_0 import (
            PostApiTriggersByIdDisableResponse200ReportType0SourceType0,
        )
        from ..models.post_api_triggers_by_id_disable_response_200_report_type_0_source_type_1 import (
            PostApiTriggersByIdDisableResponse200ReportType0SourceType1,
        )

        source: dict[str, Any]
        if isinstance(self.source, PostApiTriggersByIdDisableResponse200ReportType0SourceType0):
            source = self.source.to_dict()
        elif isinstance(self.source, PostApiTriggersByIdDisableResponse200ReportType0SourceType1):
            source = self.source.to_dict()
        else:
            source = self.source.to_dict()

        schedule = self.schedule.to_dict()

        compare_to_previous = self.compare_to_previous

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "source": source,
                "schedule": schedule,
                "compareToPrevious": compare_to_previous,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_triggers_by_id_disable_response_200_report_type_0_schedule import (
            PostApiTriggersByIdDisableResponse200ReportType0Schedule,
        )
        from ..models.post_api_triggers_by_id_disable_response_200_report_type_0_source_type_0 import (
            PostApiTriggersByIdDisableResponse200ReportType0SourceType0,
        )
        from ..models.post_api_triggers_by_id_disable_response_200_report_type_0_source_type_1 import (
            PostApiTriggersByIdDisableResponse200ReportType0SourceType1,
        )
        from ..models.post_api_triggers_by_id_disable_response_200_report_type_0_source_type_2 import (
            PostApiTriggersByIdDisableResponse200ReportType0SourceType2,
        )

        d = dict(src_dict)

        def _parse_source(
            data: object,
        ) -> (
            PostApiTriggersByIdDisableResponse200ReportType0SourceType0
            | PostApiTriggersByIdDisableResponse200ReportType0SourceType1
            | PostApiTriggersByIdDisableResponse200ReportType0SourceType2
        ):
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                source_type_0 = PostApiTriggersByIdDisableResponse200ReportType0SourceType0.from_dict(data)

                return source_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                source_type_1 = PostApiTriggersByIdDisableResponse200ReportType0SourceType1.from_dict(data)

                return source_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            source_type_2 = PostApiTriggersByIdDisableResponse200ReportType0SourceType2.from_dict(data)

            return source_type_2

        source = _parse_source(d.pop("source"))

        schedule = PostApiTriggersByIdDisableResponse200ReportType0Schedule.from_dict(d.pop("schedule"))

        compare_to_previous = d.pop("compareToPrevious")

        post_api_triggers_by_id_disable_response_200_report_type_0 = cls(
            source=source,
            schedule=schedule,
            compare_to_previous=compare_to_previous,
        )

        return post_api_triggers_by_id_disable_response_200_report_type_0
