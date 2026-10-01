from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_triggers_response_200_item_report_type_0_schedule import (
        GetApiTriggersResponse200ItemReportType0Schedule,
    )
    from ..models.get_api_triggers_response_200_item_report_type_0_source_type_0 import (
        GetApiTriggersResponse200ItemReportType0SourceType0,
    )
    from ..models.get_api_triggers_response_200_item_report_type_0_source_type_1 import (
        GetApiTriggersResponse200ItemReportType0SourceType1,
    )
    from ..models.get_api_triggers_response_200_item_report_type_0_source_type_2 import (
        GetApiTriggersResponse200ItemReportType0SourceType2,
    )


T = TypeVar("T", bound="GetApiTriggersResponse200ItemReportType0")


@_attrs_define
class GetApiTriggersResponse200ItemReportType0:
    """What a report renders and when. Null for anything else.

    Attributes:
        source (GetApiTriggersResponse200ItemReportType0SourceType0 |
            GetApiTriggersResponse200ItemReportType0SourceType1 | GetApiTriggersResponse200ItemReportType0SourceType2):
        schedule (GetApiTriggersResponse200ItemReportType0Schedule):
        compare_to_previous (bool):  Default: False.
    """

    source: (
        GetApiTriggersResponse200ItemReportType0SourceType0
        | GetApiTriggersResponse200ItemReportType0SourceType1
        | GetApiTriggersResponse200ItemReportType0SourceType2
    )
    schedule: GetApiTriggersResponse200ItemReportType0Schedule
    compare_to_previous: bool = False
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_api_triggers_response_200_item_report_type_0_source_type_0 import (
            GetApiTriggersResponse200ItemReportType0SourceType0,
        )
        from ..models.get_api_triggers_response_200_item_report_type_0_source_type_1 import (
            GetApiTriggersResponse200ItemReportType0SourceType1,
        )

        source: dict[str, Any]
        if isinstance(self.source, GetApiTriggersResponse200ItemReportType0SourceType0):
            source = self.source.to_dict()
        elif isinstance(self.source, GetApiTriggersResponse200ItemReportType0SourceType1):
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
                "compareToPrevious": compare_to_previous,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_triggers_response_200_item_report_type_0_schedule import (
            GetApiTriggersResponse200ItemReportType0Schedule,
        )
        from ..models.get_api_triggers_response_200_item_report_type_0_source_type_0 import (
            GetApiTriggersResponse200ItemReportType0SourceType0,
        )
        from ..models.get_api_triggers_response_200_item_report_type_0_source_type_1 import (
            GetApiTriggersResponse200ItemReportType0SourceType1,
        )
        from ..models.get_api_triggers_response_200_item_report_type_0_source_type_2 import (
            GetApiTriggersResponse200ItemReportType0SourceType2,
        )

        d = dict(src_dict)

        def _parse_source(
            data: object,
        ) -> (
            GetApiTriggersResponse200ItemReportType0SourceType0
            | GetApiTriggersResponse200ItemReportType0SourceType1
            | GetApiTriggersResponse200ItemReportType0SourceType2
        ):
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                source_type_0 = GetApiTriggersResponse200ItemReportType0SourceType0.from_dict(data)

                return source_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                source_type_1 = GetApiTriggersResponse200ItemReportType0SourceType1.from_dict(data)

                return source_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            source_type_2 = GetApiTriggersResponse200ItemReportType0SourceType2.from_dict(data)

            return source_type_2

        source = _parse_source(d.pop("source"))

        schedule = GetApiTriggersResponse200ItemReportType0Schedule.from_dict(d.pop("schedule"))

        compare_to_previous = d.pop("compareToPrevious")

        get_api_triggers_response_200_item_report_type_0 = cls(
            source=source,
            schedule=schedule,
            compare_to_previous=compare_to_previous,
        )

        get_api_triggers_response_200_item_report_type_0.additional_properties = d
        return get_api_triggers_response_200_item_report_type_0

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
