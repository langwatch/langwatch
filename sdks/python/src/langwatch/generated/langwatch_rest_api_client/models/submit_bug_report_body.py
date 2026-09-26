from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.submit_bug_report_body_kind import SubmitBugReportBodyKind
from ..models.submit_bug_report_body_source import SubmitBugReportBodySource
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.submit_bug_report_body_metadata import SubmitBugReportBodyMetadata


T = TypeVar("T", bound="SubmitBugReportBody")


@_attrs_define
class SubmitBugReportBody:
    """
    Attributes:
        source (SubmitBugReportBodySource):
        kind (SubmitBugReportBodyKind):
        title (str):
        summary (str | Unset):
        session_data (str | Unset):
        session_truncated (bool | Unset):
        agent (str | Unset):
        contact_email (str | Unset):
        cli_version (str | Unset):
        metadata (SubmitBugReportBodyMetadata | Unset):
    """

    source: SubmitBugReportBodySource
    kind: SubmitBugReportBodyKind
    title: str
    summary: str | Unset = UNSET
    session_data: str | Unset = UNSET
    session_truncated: bool | Unset = UNSET
    agent: str | Unset = UNSET
    contact_email: str | Unset = UNSET
    cli_version: str | Unset = UNSET
    metadata: SubmitBugReportBodyMetadata | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        source = self.source.value

        kind = self.kind.value

        title = self.title

        summary = self.summary

        session_data = self.session_data

        session_truncated = self.session_truncated

        agent = self.agent

        contact_email = self.contact_email

        cli_version = self.cli_version

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "source": source,
                "kind": kind,
                "title": title,
            }
        )
        if summary is not UNSET:
            field_dict["summary"] = summary
        if session_data is not UNSET:
            field_dict["sessionData"] = session_data
        if session_truncated is not UNSET:
            field_dict["sessionTruncated"] = session_truncated
        if agent is not UNSET:
            field_dict["agent"] = agent
        if contact_email is not UNSET:
            field_dict["contactEmail"] = contact_email
        if cli_version is not UNSET:
            field_dict["cliVersion"] = cli_version
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.submit_bug_report_body_metadata import SubmitBugReportBodyMetadata

        d = dict(src_dict)
        source = SubmitBugReportBodySource(d.pop("source"))

        kind = SubmitBugReportBodyKind(d.pop("kind"))

        title = d.pop("title")

        summary = d.pop("summary", UNSET)

        session_data = d.pop("sessionData", UNSET)

        session_truncated = d.pop("sessionTruncated", UNSET)

        agent = d.pop("agent", UNSET)

        contact_email = d.pop("contactEmail", UNSET)

        cli_version = d.pop("cliVersion", UNSET)

        _metadata = d.pop("metadata", UNSET)
        metadata: SubmitBugReportBodyMetadata | Unset
        if isinstance(_metadata, Unset):
            metadata = UNSET
        else:
            metadata = SubmitBugReportBodyMetadata.from_dict(_metadata)

        submit_bug_report_body = cls(
            source=source,
            kind=kind,
            title=title,
            summary=summary,
            session_data=session_data,
            session_truncated=session_truncated,
            agent=agent,
            contact_email=contact_email,
            cli_version=cli_version,
            metadata=metadata,
        )

        submit_bug_report_body.additional_properties = d
        return submit_bug_report_body

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
