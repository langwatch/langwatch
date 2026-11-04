from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from dateutil.parser import isoparse

from ..models.list_agent_versions_response_200_data_item_author_kind_type_0 import (
    ListAgentVersionsResponse200DataItemAuthorKindType0,
)
from ..models.list_agent_versions_response_200_data_item_type import ListAgentVersionsResponse200DataItemType

if TYPE_CHECKING:
    from ..models.list_agent_versions_response_200_data_item_author_type_0 import (
        ListAgentVersionsResponse200DataItemAuthorType0,
    )
    from ..models.list_agent_versions_response_200_data_item_config import ListAgentVersionsResponse200DataItemConfig


T = TypeVar("T", bound="ListAgentVersionsResponse200DataItem")


@_attrs_define
class ListAgentVersionsResponse200DataItem:
    """
    Attributes:
        id (str):
        agent_id (str):
        project_id (str):
        version (int):
        name (str):
        type_ (ListAgentVersionsResponse200DataItemType):
        config (ListAgentVersionsResponse200DataItemConfig):
        workflow_id (None | str):
        commit_message (None | str):
        author_id (None | str):
        author_kind (ListAgentVersionsResponse200DataItemAuthorKindType0 | None):
        author (ListAgentVersionsResponse200DataItemAuthorType0 | None):
        created_at (datetime.datetime):
        labels (list[str]):
    """

    id: str
    agent_id: str
    project_id: str
    version: int
    name: str
    type_: ListAgentVersionsResponse200DataItemType
    config: ListAgentVersionsResponse200DataItemConfig
    workflow_id: None | str
    commit_message: None | str
    author_id: None | str
    author_kind: ListAgentVersionsResponse200DataItemAuthorKindType0 | None
    author: ListAgentVersionsResponse200DataItemAuthorType0 | None
    created_at: datetime.datetime
    labels: list[str]

    def to_dict(self) -> dict[str, Any]:
        from ..models.list_agent_versions_response_200_data_item_author_type_0 import (
            ListAgentVersionsResponse200DataItemAuthorType0,
        )

        id = self.id

        agent_id = self.agent_id

        project_id = self.project_id

        version = self.version

        name = self.name

        type_ = self.type_.value

        config = self.config.to_dict()

        workflow_id: None | str
        workflow_id = self.workflow_id

        commit_message: None | str
        commit_message = self.commit_message

        author_id: None | str
        author_id = self.author_id

        author_kind: None | str
        if isinstance(self.author_kind, ListAgentVersionsResponse200DataItemAuthorKindType0):
            author_kind = self.author_kind.value
        else:
            author_kind = self.author_kind

        author: dict[str, Any] | None
        if isinstance(self.author, ListAgentVersionsResponse200DataItemAuthorType0):
            author = self.author.to_dict()
        else:
            author = self.author

        created_at = self.created_at.isoformat()

        labels = self.labels

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "agentId": agent_id,
                "projectId": project_id,
                "version": version,
                "name": name,
                "type": type_,
                "config": config,
                "workflowId": workflow_id,
                "commitMessage": commit_message,
                "authorId": author_id,
                "authorKind": author_kind,
                "author": author,
                "createdAt": created_at,
                "labels": labels,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.list_agent_versions_response_200_data_item_author_type_0 import (
            ListAgentVersionsResponse200DataItemAuthorType0,
        )
        from ..models.list_agent_versions_response_200_data_item_config import (
            ListAgentVersionsResponse200DataItemConfig,
        )

        d = dict(src_dict)
        id = d.pop("id")

        agent_id = d.pop("agentId")

        project_id = d.pop("projectId")

        version = d.pop("version")

        name = d.pop("name")

        type_ = ListAgentVersionsResponse200DataItemType(d.pop("type"))

        config = ListAgentVersionsResponse200DataItemConfig.from_dict(d.pop("config"))

        def _parse_workflow_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        workflow_id = _parse_workflow_id(d.pop("workflowId"))

        def _parse_commit_message(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        commit_message = _parse_commit_message(d.pop("commitMessage"))

        def _parse_author_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        author_id = _parse_author_id(d.pop("authorId"))

        def _parse_author_kind(data: object) -> ListAgentVersionsResponse200DataItemAuthorKindType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                author_kind_type_0 = ListAgentVersionsResponse200DataItemAuthorKindType0(data)

                return author_kind_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(ListAgentVersionsResponse200DataItemAuthorKindType0 | None, data)

        author_kind = _parse_author_kind(d.pop("authorKind"))

        def _parse_author(data: object) -> ListAgentVersionsResponse200DataItemAuthorType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                author_type_0 = ListAgentVersionsResponse200DataItemAuthorType0.from_dict(data)

                return author_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(ListAgentVersionsResponse200DataItemAuthorType0 | None, data)

        author = _parse_author(d.pop("author"))

        created_at = isoparse(d.pop("createdAt"))

        labels = cast(list[str], d.pop("labels"))

        list_agent_versions_response_200_data_item = cls(
            id=id,
            agent_id=agent_id,
            project_id=project_id,
            version=version,
            name=name,
            type_=type_,
            config=config,
            workflow_id=workflow_id,
            commit_message=commit_message,
            author_id=author_id,
            author_kind=author_kind,
            author=author,
            created_at=created_at,
            labels=labels,
        )

        return list_agent_versions_response_200_data_item
