from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from dateutil.parser import isoparse

T = TypeVar("T", bound="PostApiV1QueryBodyTimeWindow")


@_attrs_define
class PostApiV1QueryBodyTimeWindow:
    """
    Attributes:
        start (datetime.datetime | float | str):
        end (datetime.datetime | float | str):
    """

    start: datetime.datetime | float | str
    end: datetime.datetime | float | str

    def to_dict(self) -> dict[str, Any]:
        start: float | str
        if isinstance(self.start, datetime.datetime):
            start = self.start.isoformat()
        else:
            start = self.start

        end: float | str
        if isinstance(self.end, datetime.datetime):
            end = self.end.isoformat()
        else:
            end = self.end

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "start": start,
                "end": end,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)

        def _parse_start(data: object) -> datetime.datetime | float | str:
            try:
                if not isinstance(data, str):
                    raise TypeError()
                start_type_2 = isoparse(data)

                return start_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | float | str, data)

        start = _parse_start(d.pop("start"))

        def _parse_end(data: object) -> datetime.datetime | float | str:
            try:
                if not isinstance(data, str):
                    raise TypeError()
                end_type_2 = isoparse(data)

                return end_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | float | str, data)

        end = _parse_end(d.pop("end"))

        post_api_v1_query_body_time_window = cls(
            start=start,
            end=end,
        )

        return post_api_v1_query_body_time_window
