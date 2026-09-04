from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiExperimentsBySlugRunResponse200")


@_attrs_define
class PostApiExperimentsBySlugRunResponse200:
    """
    Attributes:
        run_id (str): Identifier to poll this run with
        status (Literal['running']):
        total (float): Number of cells this run will execute
        run_url (str | Unset): Link to the run in the LangWatch app
    """

    run_id: str
    status: Literal["running"]
    total: float
    run_url: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        run_id = self.run_id

        status = self.status

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

        status = cast(Literal["running"], d.pop("status"))
        if status != "running":
            raise ValueError(f"status must match const 'running', got '{status}'")

        total = d.pop("total")

        run_url = d.pop("runUrl", UNSET)

        post_api_experiments_by_slug_run_response_200 = cls(
            run_id=run_id,
            status=status,
            total=total,
            run_url=run_url,
        )

        post_api_experiments_by_slug_run_response_200.additional_properties = d
        return post_api_experiments_by_slug_run_response_200

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
