from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.langy_local_workspace_response_200_code_access_preference_type_0 import (
    LangyLocalWorkspaceResponse200CodeAccessPreferenceType0,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.langy_local_workspace_response_200_github import LangyLocalWorkspaceResponse200Github
    from ..models.langy_local_workspace_response_200_pending_request import LangyLocalWorkspaceResponse200PendingRequest
    from ..models.langy_local_workspace_response_200_workspace import LangyLocalWorkspaceResponse200Workspace


T = TypeVar("T", bound="LangyLocalWorkspaceResponse200")


@_attrs_define
class LangyLocalWorkspaceResponse200:
    """
    Attributes:
        connected (bool):
        code_access_preference (LangyLocalWorkspaceResponse200CodeAccessPreferenceType0 | None):
        github (LangyLocalWorkspaceResponse200Github):
        workspace (LangyLocalWorkspaceResponse200Workspace | Unset):
        pending_request (LangyLocalWorkspaceResponse200PendingRequest | Unset):
    """

    connected: bool
    code_access_preference: LangyLocalWorkspaceResponse200CodeAccessPreferenceType0 | None
    github: LangyLocalWorkspaceResponse200Github
    workspace: LangyLocalWorkspaceResponse200Workspace | Unset = UNSET
    pending_request: LangyLocalWorkspaceResponse200PendingRequest | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        connected = self.connected

        code_access_preference: None | str
        if isinstance(self.code_access_preference, LangyLocalWorkspaceResponse200CodeAccessPreferenceType0):
            code_access_preference = self.code_access_preference.value
        else:
            code_access_preference = self.code_access_preference

        github = self.github.to_dict()

        workspace: dict[str, Any] | Unset = UNSET
        if not isinstance(self.workspace, Unset):
            workspace = self.workspace.to_dict()

        pending_request: dict[str, Any] | Unset = UNSET
        if not isinstance(self.pending_request, Unset):
            pending_request = self.pending_request.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "connected": connected,
                "codeAccessPreference": code_access_preference,
                "github": github,
            }
        )
        if workspace is not UNSET:
            field_dict["workspace"] = workspace
        if pending_request is not UNSET:
            field_dict["pendingRequest"] = pending_request

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.langy_local_workspace_response_200_github import LangyLocalWorkspaceResponse200Github
        from ..models.langy_local_workspace_response_200_pending_request import (
            LangyLocalWorkspaceResponse200PendingRequest,
        )
        from ..models.langy_local_workspace_response_200_workspace import LangyLocalWorkspaceResponse200Workspace

        d = dict(src_dict)
        connected = d.pop("connected")

        def _parse_code_access_preference(
            data: object,
        ) -> LangyLocalWorkspaceResponse200CodeAccessPreferenceType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                code_access_preference_type_0 = LangyLocalWorkspaceResponse200CodeAccessPreferenceType0(data)

                return code_access_preference_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(LangyLocalWorkspaceResponse200CodeAccessPreferenceType0 | None, data)

        code_access_preference = _parse_code_access_preference(d.pop("codeAccessPreference"))

        github = LangyLocalWorkspaceResponse200Github.from_dict(d.pop("github"))

        _workspace = d.pop("workspace", UNSET)
        workspace: LangyLocalWorkspaceResponse200Workspace | Unset
        if isinstance(_workspace, Unset):
            workspace = UNSET
        else:
            workspace = LangyLocalWorkspaceResponse200Workspace.from_dict(_workspace)

        _pending_request = d.pop("pendingRequest", UNSET)
        pending_request: LangyLocalWorkspaceResponse200PendingRequest | Unset
        if isinstance(_pending_request, Unset):
            pending_request = UNSET
        else:
            pending_request = LangyLocalWorkspaceResponse200PendingRequest.from_dict(_pending_request)

        langy_local_workspace_response_200 = cls(
            connected=connected,
            code_access_preference=code_access_preference,
            github=github,
            workspace=workspace,
            pending_request=pending_request,
        )

        return langy_local_workspace_response_200
