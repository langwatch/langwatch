from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

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

    def to_dict(self) -> dict[str, Any]:
        run_id = self.run_id

        status = self.status

        total = self.total

        run_url = self.run_url

        field_dict: dict[str, Any] = {}

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

        return post_api_experiments_by_slug_run_response_200
