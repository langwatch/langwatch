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

import pytest

from langevals import utils


@pytest.fixture
def cgroup_files(monkeypatch):
    files: dict[str, str] = {}
    real_open = builtins.open

    def fake_open(path, *args, **kwargs):
        if str(path) in files:
            return io.StringIO(files[str(path)])
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


def test_cgroup_v2_without_limit_falls_through(cgroup_files):
    cgroup_files["/sys/fs/cgroup/cpu.max"] = "max 100000"

    assert utils.get_cpu_count() >= 1


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
