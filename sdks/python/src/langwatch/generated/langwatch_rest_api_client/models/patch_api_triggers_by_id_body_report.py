from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.patch_api_triggers_by_id_body_report_schedule import PatchApiTriggersByIdBodyReportSchedule
    from ..models.patch_api_triggers_by_id_body_report_source_type_0 import PatchApiTriggersByIdBodyReportSourceType0
    from ..models.patch_api_triggers_by_id_body_report_source_type_1 import PatchApiTriggersByIdBodyReportSourceType1
    from ..models.patch_api_triggers_by_id_body_report_source_type_2 import PatchApiTriggersByIdBodyReportSourceType2


T = TypeVar("T", bound="PatchApiTriggersByIdBodyReport")


@_attrs_define
class PatchApiTriggersByIdBodyReport:
    """What this report renders and when. Only for one that is a report.

    Attributes:
        source (PatchApiTriggersByIdBodyReportSourceType0 | PatchApiTriggersByIdBodyReportSourceType1 |
            PatchApiTriggersByIdBodyReportSourceType2):
        schedule (PatchApiTriggersByIdBodyReportSchedule):
        compare_to_previous (bool | Unset):  Default: False.
    """

    source: (
        PatchApiTriggersByIdBodyReportSourceType0
        | PatchApiTriggersByIdBodyReportSourceType1
        | PatchApiTriggersByIdBodyReportSourceType2
    )
    schedule: PatchApiTriggersByIdBodyReportSchedule
    compare_to_previous: bool | Unset = False
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.patch_api_triggers_by_id_body_report_source_type_0 import (
            PatchApiTriggersByIdBodyReportSourceType0,
        )
        from ..models.patch_api_triggers_by_id_body_report_source_type_1 import (
            PatchApiTriggersByIdBodyReportSourceType1,
        )

        source: dict[str, Any]
        if isinstance(self.source, PatchApiTriggersByIdBodyReportSourceType0):
            source = self.source.to_dict()
        elif isinstance(self.source, PatchApiTriggersByIdBodyReportSourceType1):
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
        from ..models.patch_api_triggers_by_id_body_report_schedule import PatchApiTriggersByIdBodyReportSchedule
        from ..models.patch_api_triggers_by_id_body_report_source_type_0 import (
            PatchApiTriggersByIdBodyReportSourceType0,
        )
        from ..models.patch_api_triggers_by_id_body_report_source_type_1 import (
            PatchApiTriggersByIdBodyReportSourceType1,
        )
        from ..models.patch_api_triggers_by_id_body_report_source_type_2 import (
            PatchApiTriggersByIdBodyReportSourceType2,
        )

        d = dict(src_dict)

        def _parse_source(
            data: object,
        ) -> (
            PatchApiTriggersByIdBodyReportSourceType0
            | PatchApiTriggersByIdBodyReportSourceType1
            | PatchApiTriggersByIdBodyReportSourceType2
        ):
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                source_type_0 = PatchApiTriggersByIdBodyReportSourceType0.from_dict(data)

                return source_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                source_type_1 = PatchApiTriggersByIdBodyReportSourceType1.from_dict(data)

                return source_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            source_type_2 = PatchApiTriggersByIdBodyReportSourceType2.from_dict(data)

            return source_type_2

        source = _parse_source(d.pop("source"))

        schedule = PatchApiTriggersByIdBodyReportSchedule.from_dict(d.pop("schedule"))

        compare_to_previous = d.pop("compareToPrevious", UNSET)

        patch_api_triggers_by_id_body_report = cls(
            source=source,
            schedule=schedule,
            compare_to_previous=compare_to_previous,
        )

        patch_api_triggers_by_id_body_report.additional_properties = d
        return patch_api_triggers_by_id_body_report

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
