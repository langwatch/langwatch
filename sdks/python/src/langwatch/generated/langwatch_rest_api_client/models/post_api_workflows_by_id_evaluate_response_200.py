from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostApiWorkflowsByIdEvaluateResponse200")


@_attrs_define
class PostApiWorkflowsByIdEvaluateResponse200:
    """
    Attributes:
        run_id (str):
        run_url (str):
        workflow_version_id (str):
        version (str):
    """

    run_id: str
    run_url: str
    workflow_version_id: str
    version: str

    def to_dict(self) -> dict[str, Any]:
        run_id = self.run_id

        run_url = self.run_url

        workflow_version_id = self.workflow_version_id

        version = self.version

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "run_id": run_id,
                "run_url": run_url,
                "workflow_version_id": workflow_version_id,
                "version": version,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        run_id = d.pop("run_id")

        run_url = d.pop("run_url")

        workflow_version_id = d.pop("workflow_version_id")

        version = d.pop("version")

        post_api_workflows_by_id_evaluate_response_200 = cls(
            run_id=run_id,
            run_url=run_url,
            workflow_version_id=workflow_version_id,
            version=version,
        )

        return post_api_workflows_by_id_evaluate_response_200
