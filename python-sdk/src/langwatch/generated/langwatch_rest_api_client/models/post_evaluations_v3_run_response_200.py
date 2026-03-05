from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_evaluations_v3_run_response_200_status import PostEvaluationsV3RunResponse200Status
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostEvaluationsV3RunResponse200")


@_attrs_define
class PostEvaluationsV3RunResponse200:
    """
    Attributes:
        run_id (str): Unique identifier for this run
        status (PostEvaluationsV3RunResponse200Status): Initial status of the run
        total (int): Total number of cells to execute
        run_url (str | Unset): URL to view the run in LangWatch
    """

    run_id: str
    status: PostEvaluationsV3RunResponse200Status
    total: int
    run_url: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        run_id = self.run_id

        status = self.status.value

        total = self.total

        run_url = self.run_url

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "runId": run_id,
                "status": status,
                "total": total,
            }
        )
        if run_url is not UNSET:
            field_dict["runUrl"] = run_url

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        run_id = d.pop("runId")

        status = PostEvaluationsV3RunResponse200Status(d.pop("status"))

        total = d.pop("total")

        run_url = d.pop("runUrl", UNSET)

        post_evaluations_v3_run_response_200 = cls(
            run_id=run_id,
            status=status,
            total=total,
            run_url=run_url,
        )

        post_evaluations_v3_run_response_200.additional_properties = d
        return post_evaluations_v3_run_response_200

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
