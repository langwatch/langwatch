from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_api_experiments_runs_response_200_runs_item_workflow_version_type_0_author_type_0 import (
        GetApiExperimentsRunsResponse200RunsItemWorkflowVersionType0AuthorType0,
    )


T = TypeVar("T", bound="GetApiExperimentsRunsResponse200RunsItemWorkflowVersionType0")


@_attrs_define
class GetApiExperimentsRunsResponse200RunsItemWorkflowVersionType0:
    """
    Attributes:
        id (str):
        version (str):
        commit_message (str):
        author (GetApiExperimentsRunsResponse200RunsItemWorkflowVersionType0AuthorType0 | None):
    """

    id: str
    version: str
    commit_message: str
    author: GetApiExperimentsRunsResponse200RunsItemWorkflowVersionType0AuthorType0 | None

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_api_experiments_runs_response_200_runs_item_workflow_version_type_0_author_type_0 import (
            GetApiExperimentsRunsResponse200RunsItemWorkflowVersionType0AuthorType0,
        )

        id = self.id

        version = self.version

        commit_message = self.commit_message

        author: dict[str, Any] | None
        if isinstance(self.author, GetApiExperimentsRunsResponse200RunsItemWorkflowVersionType0AuthorType0):
            author = self.author.to_dict()
        else:
            author = self.author

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "version": version,
                "commitMessage": commit_message,
                "author": author,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_experiments_runs_response_200_runs_item_workflow_version_type_0_author_type_0 import (
            GetApiExperimentsRunsResponse200RunsItemWorkflowVersionType0AuthorType0,
        )

        d = dict(src_dict)
        id = d.pop("id")

        version = d.pop("version")

        commit_message = d.pop("commitMessage")

        def _parse_author(
            data: object,
        ) -> GetApiExperimentsRunsResponse200RunsItemWorkflowVersionType0AuthorType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                author_type_0 = GetApiExperimentsRunsResponse200RunsItemWorkflowVersionType0AuthorType0.from_dict(data)

                return author_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetApiExperimentsRunsResponse200RunsItemWorkflowVersionType0AuthorType0 | None, data)

        author = _parse_author(d.pop("author"))

        get_api_experiments_runs_response_200_runs_item_workflow_version_type_0 = cls(
            id=id,
            version=version,
            commit_message=commit_message,
            author=author,
        )

        return get_api_experiments_runs_response_200_runs_item_workflow_version_type_0
