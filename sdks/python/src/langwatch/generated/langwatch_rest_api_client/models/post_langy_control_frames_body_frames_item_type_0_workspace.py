from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostLangyControlFramesBodyFramesItemType0Workspace")


@_attrs_define
class PostLangyControlFramesBodyFramesItemType0Workspace:
    """
    Attributes:
        root (str):
        name (str):
        os (str):
        git_repository (bool | Unset):
        git_branch (str | Unset):
        git_remote (str | Unset):
        git_dirty (bool | Unset):
        node_version (str | Unset):
        python_version (str | Unset):
        gh_authenticated (bool | Unset):
        package_manager (str | Unset):
    """

    root: str
    name: str
    os: str
    git_repository: bool | Unset = UNSET
    git_branch: str | Unset = UNSET
    git_remote: str | Unset = UNSET
    git_dirty: bool | Unset = UNSET
    node_version: str | Unset = UNSET
    python_version: str | Unset = UNSET
    gh_authenticated: bool | Unset = UNSET
    package_manager: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        root = self.root

        name = self.name

        os = self.os

        git_repository = self.git_repository

        git_branch = self.git_branch

        git_remote = self.git_remote

        git_dirty = self.git_dirty

        node_version = self.node_version

        python_version = self.python_version

        gh_authenticated = self.gh_authenticated

        package_manager = self.package_manager

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "root": root,
                "name": name,
                "os": os,
            }
        )
        if git_repository is not UNSET:
            field_dict["gitRepository"] = git_repository
        if git_branch is not UNSET:
            field_dict["gitBranch"] = git_branch
        if git_remote is not UNSET:
            field_dict["gitRemote"] = git_remote
        if git_dirty is not UNSET:
            field_dict["gitDirty"] = git_dirty
        if node_version is not UNSET:
            field_dict["nodeVersion"] = node_version
        if python_version is not UNSET:
            field_dict["pythonVersion"] = python_version
        if gh_authenticated is not UNSET:
            field_dict["ghAuthenticated"] = gh_authenticated
        if package_manager is not UNSET:
            field_dict["packageManager"] = package_manager

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        root = d.pop("root")

        name = d.pop("name")

        os = d.pop("os")

        git_repository = d.pop("gitRepository", UNSET)

        git_branch = d.pop("gitBranch", UNSET)

        git_remote = d.pop("gitRemote", UNSET)

        git_dirty = d.pop("gitDirty", UNSET)

        node_version = d.pop("nodeVersion", UNSET)

        python_version = d.pop("pythonVersion", UNSET)

        gh_authenticated = d.pop("ghAuthenticated", UNSET)

        package_manager = d.pop("packageManager", UNSET)

        post_langy_control_frames_body_frames_item_type_0_workspace = cls(
            root=root,
            name=name,
            os=os,
            git_repository=git_repository,
            git_branch=git_branch,
            git_remote=git_remote,
            git_dirty=git_dirty,
            node_version=node_version,
            python_version=python_version,
            gh_authenticated=gh_authenticated,
            package_manager=package_manager,
        )

        post_langy_control_frames_body_frames_item_type_0_workspace.additional_properties = d
        return post_langy_control_frames_body_frames_item_type_0_workspace

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
