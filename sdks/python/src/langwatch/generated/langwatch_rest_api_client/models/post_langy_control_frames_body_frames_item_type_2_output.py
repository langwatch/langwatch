from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostLangyControlFramesBodyFramesItemType2Output")


@_attrs_define
class PostLangyControlFramesBodyFramesItemType2Output:
    """
    Attributes:
        exit_code (int | None):
        stdout (str):
        stderr (str):
        truncated (bool):
        duration_ms (int):
        log_path (str | Unset):
        pid (int | Unset):
    """

    exit_code: int | None
    stdout: str
    stderr: str
    truncated: bool
    duration_ms: int
    log_path: str | Unset = UNSET
    pid: int | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        exit_code: int | None
        exit_code = self.exit_code

        stdout = self.stdout

        stderr = self.stderr

        truncated = self.truncated

        duration_ms = self.duration_ms

        log_path = self.log_path

        pid = self.pid

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "exitCode": exit_code,
                "stdout": stdout,
                "stderr": stderr,
                "truncated": truncated,
                "durationMs": duration_ms,
            }
        )
        if log_path is not UNSET:
            field_dict["logPath"] = log_path
        if pid is not UNSET:
            field_dict["pid"] = pid

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)

        def _parse_exit_code(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        exit_code = _parse_exit_code(d.pop("exitCode"))

        stdout = d.pop("stdout")

        stderr = d.pop("stderr")

        truncated = d.pop("truncated")

        duration_ms = d.pop("durationMs")

        log_path = d.pop("logPath", UNSET)

        pid = d.pop("pid", UNSET)

        post_langy_control_frames_body_frames_item_type_2_output = cls(
            exit_code=exit_code,
            stdout=stdout,
            stderr=stderr,
            truncated=truncated,
            duration_ms=duration_ms,
            log_path=log_path,
            pid=pid,
        )

        return post_langy_control_frames_body_frames_item_type_2_output
