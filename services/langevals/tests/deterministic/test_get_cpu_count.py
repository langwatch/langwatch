"""Unit tests for the worker-count detection in `get_cpu_count`.

A container's CPU limit is only visible in the cgroup files: `os.cpu_count()`
and scheduler affinity report the host's cores. Reading only the cgroup v1
path meant every cgroup v2 runtime (any current Kubernetes or Docker) fell
through to host cores, so a 1-CPU pod booted one heavy worker per host core
and ran out of memory. No cgroups are involved here: the files are faked by
intercepting `open` on the two known paths.
"""

import builtins
import io
import os

import pytest

from langevals import utils


@pytest.fixture
def cgroup_files(monkeypatch):
    """Fake the two cgroup paths.

    A value is either the file's contents, or an exception to raise when the
    file is opened, which is how the unreadable-file cases are set up.
    """
    files: dict[str, str | Exception] = {}
    real_open = builtins.open

    def fake_open(path, *args, **kwargs):
        if str(path) in files:
            contents = files[str(path)]
            if isinstance(contents, Exception):
                raise contents
            return io.StringIO(contents)
        if str(path).startswith("/sys/fs/cgroup/"):
            raise FileNotFoundError(path)
        return real_open(path, *args, **kwargs)

    monkeypatch.setattr(builtins, "open", fake_open)
    monkeypatch.delenv("CPU_COUNT", raising=False)
    monkeypatch.delenv("WEB_CONCURRENCY", raising=False)
    return files


def test_cgroup_v2_quota_wins_over_host_cores(cgroup_files):
    cgroup_files["/sys/fs/cgroup/cpu.max"] = "100000 100000"

    assert utils.get_cpu_count() == 1


def test_cgroup_v2_fractional_quota_rounds_up(cgroup_files):
    cgroup_files["/sys/fs/cgroup/cpu.max"] = "150000 100000"

    assert utils.get_cpu_count() == 2


def test_cgroup_v2_without_limit_falls_through_to_v1(cgroup_files):
    cgroup_files["/sys/fs/cgroup/cpu.max"] = "max 100000"
    cgroup_files["/sys/fs/cgroup/cpu/cpu.shares"] = "2048"

    assert utils.get_cpu_count() == 2


def test_cgroup_v1_shares_still_work(cgroup_files):
    cgroup_files["/sys/fs/cgroup/cpu/cpu.shares"] = "2048"

    assert utils.get_cpu_count() == 2


def test_cpu_count_env_wins(cgroup_files, monkeypatch):
    cgroup_files["/sys/fs/cgroup/cpu.max"] = "400000 100000"
    monkeypatch.setenv("CPU_COUNT", "2")

    assert utils.get_cpu_count() == 2


def test_web_concurrency_env_wins(cgroup_files, monkeypatch):
    cgroup_files["/sys/fs/cgroup/cpu.max"] = "400000 100000"
    monkeypatch.setenv("WEB_CONCURRENCY", "3")

    assert utils.get_cpu_count() == 3


# An override the server cannot use must be ignored, not fatal. `CPU_COUNT: ""`
# is what a manifest produces for a value an operator left blank, and
# get_cpu_count runs while the server boots, so raising takes the pod down.


def test_empty_override_is_ignored(cgroup_files, monkeypatch):
    cgroup_files["/sys/fs/cgroup/cpu.max"] = "400000 100000"
    monkeypatch.setenv("CPU_COUNT", "")

    assert utils.get_cpu_count() == 4


def test_non_numeric_override_is_ignored(cgroup_files, monkeypatch):
    cgroup_files["/sys/fs/cgroup/cpu.max"] = "400000 100000"
    monkeypatch.setenv("CPU_COUNT", "two")

    assert utils.get_cpu_count() == 4


def test_zero_override_is_ignored(cgroup_files, monkeypatch):
    cgroup_files["/sys/fs/cgroup/cpu.max"] = "400000 100000"
    monkeypatch.setenv("CPU_COUNT", "0")

    assert utils.get_cpu_count() == 4


def test_empty_cpu_count_still_lets_web_concurrency_apply(cgroup_files, monkeypatch):
    cgroup_files["/sys/fs/cgroup/cpu.max"] = "400000 100000"
    monkeypatch.setenv("CPU_COUNT", "")
    monkeypatch.setenv("WEB_CONCURRENCY", "3")

    assert utils.get_cpu_count() == 3


def test_zero_cpu_max_period_falls_through_to_v1(cgroup_files):
    cgroup_files["/sys/fs/cgroup/cpu.max"] = "100000 0"
    cgroup_files["/sys/fs/cgroup/cpu/cpu.shares"] = "2048"

    assert utils.get_cpu_count() == 2


def test_malformed_cpu_max_falls_through_to_v1(cgroup_files):
    cgroup_files["/sys/fs/cgroup/cpu.max"] = "garbage"
    cgroup_files["/sys/fs/cgroup/cpu/cpu.shares"] = "2048"

    assert utils.get_cpu_count() == 2


def test_unreadable_cgroup_files_fall_through_to_local(cgroup_files, monkeypatch):
    cgroup_files["/sys/fs/cgroup/cpu.max"] = PermissionError("denied")
    cgroup_files["/sys/fs/cgroup/cpu/cpu.shares"] = PermissionError("denied")
    monkeypatch.setattr(os, "sched_getaffinity", lambda pid: {0, 1, 2}, raising=False)

    assert utils.get_cpu_count() == 3
