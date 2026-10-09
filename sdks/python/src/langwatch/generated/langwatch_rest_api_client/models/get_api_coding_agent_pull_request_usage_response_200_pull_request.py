from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="GetApiCodingAgentPullRequestUsageResponse200PullRequest")


@_attrs_define
class GetApiCodingAgentPullRequestUsageResponse200PullRequest:
    """
    Attributes:
        repository_host (str):
        repository_full_name (str):
        pr_number (float):
        head_branch (str):
        html_url (str):
        state (str):
        is_draft (bool):
        author_login (None | str):
        pr_created_at_ms (float):
        pr_closed_at_ms (float | None):
        pr_merged_at_ms (float | None):
    """

    repository_host: str
    repository_full_name: str
    pr_number: float
    head_branch: str
    html_url: str
    state: str
    is_draft: bool
    author_login: None | str
    pr_created_at_ms: float
    pr_closed_at_ms: float | None
    pr_merged_at_ms: float | None
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        repository_host = self.repository_host

        repository_full_name = self.repository_full_name

        pr_number = self.pr_number

        head_branch = self.head_branch

        html_url = self.html_url

        state = self.state

        is_draft = self.is_draft

        author_login: None | str
        author_login = self.author_login

        pr_created_at_ms = self.pr_created_at_ms

        pr_closed_at_ms: float | None
        pr_closed_at_ms = self.pr_closed_at_ms

        pr_merged_at_ms: float | None
        pr_merged_at_ms = self.pr_merged_at_ms

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "repositoryHost": repository_host,
                "repositoryFullName": repository_full_name,
                "prNumber": pr_number,
                "headBranch": head_branch,
                "htmlUrl": html_url,
                "state": state,
                "isDraft": is_draft,
                "authorLogin": author_login,
                "prCreatedAtMs": pr_created_at_ms,
                "prClosedAtMs": pr_closed_at_ms,
                "prMergedAtMs": pr_merged_at_ms,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        repository_host = d.pop("repositoryHost")

        repository_full_name = d.pop("repositoryFullName")

        pr_number = d.pop("prNumber")

        head_branch = d.pop("headBranch")

        html_url = d.pop("htmlUrl")

        state = d.pop("state")

        is_draft = d.pop("isDraft")

        def _parse_author_login(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        author_login = _parse_author_login(d.pop("authorLogin"))

        pr_created_at_ms = d.pop("prCreatedAtMs")

        def _parse_pr_closed_at_ms(data: object) -> float | None:
            if data is None:
                return data
            return cast(float | None, data)

        pr_closed_at_ms = _parse_pr_closed_at_ms(d.pop("prClosedAtMs"))

        def _parse_pr_merged_at_ms(data: object) -> float | None:
            if data is None:
                return data
            return cast(float | None, data)

        pr_merged_at_ms = _parse_pr_merged_at_ms(d.pop("prMergedAtMs"))

        get_api_coding_agent_pull_request_usage_response_200_pull_request = cls(
            repository_host=repository_host,
            repository_full_name=repository_full_name,
            pr_number=pr_number,
            head_branch=head_branch,
            html_url=html_url,
            state=state,
            is_draft=is_draft,
            author_login=author_login,
            pr_created_at_ms=pr_created_at_ms,
            pr_closed_at_ms=pr_closed_at_ms,
            pr_merged_at_ms=pr_merged_at_ms,
        )

        get_api_coding_agent_pull_request_usage_response_200_pull_request.additional_properties = d
        return get_api_coding_agent_pull_request_usage_response_200_pull_request

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
