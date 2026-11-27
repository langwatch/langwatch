"""Where a model call may connect: the deployment's egress policy, enforced.

The same rules as packages/egress/src/ssrf (address.ts, url-validator.ts,
fenced-fetch.ts) and the NLP service's httpblock, read from the same server
variables, so every LangWatch service refuses the same destinations.
"""

import ipaddress
import os
import socket
import threading
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from functools import wraps
from typing import Iterator, Literal, Optional
from urllib.parse import urlsplit

import httpx

Category = Literal["global", "metadata", "special"]

# Cloud instance-metadata endpoints, refused whatever the policy or allow-list says.
_METADATA_ADDRESSES = frozenset(
    ipaddress.ip_address(address)
    for address in (
        "169.254.169.254",  # AWS/GCP/Azure/Oracle IMDS
        "169.254.170.2",  # AWS ECS/Fargate task metadata
        "168.63.129.16",  # Azure WireServer
        "100.100.100.200",  # Alibaba Cloud ECS metadata
        "192.0.0.192",  # Oracle Cloud metadata
        "fd00:ec2::254",  # AWS EC2 IMDS over IPv6
    )
)
_METADATA_HOSTS = frozenset({"metadata", "metadata.google.internal", "metadata.goog"})

# Every non-globally-routable range, as address.ts lists it.
_SPECIAL_NETWORKS = tuple(
    ipaddress.ip_network(network)
    for network in (
        "0.0.0.0/8",
        "10.0.0.0/8",
        "100.64.0.0/10",
        "127.0.0.0/8",
        "169.254.0.0/16",
        "172.16.0.0/12",
        "192.0.0.0/24",
        "192.0.2.0/24",
        "192.88.99.0/24",
        "192.168.0.0/16",
        "198.18.0.0/15",
        "198.51.100.0/24",
        "203.0.113.0/24",
        "224.0.0.0/4",
        "240.0.0.0/4",
        "::/128",
        "::1/128",
        "64:ff9b::/96",
        "64:ff9b:1::/48",
        "100::/64",
        "2001::/32",
        "2001:db8::/32",
        "2002::/16",
        "3fff::/20",
        "fc00::/7",
        "fe80::/10",
        "ff00::/8",
    )
)


class EgressDestinationRefusedError(ValueError):
    """The destination was refused by the egress policy before anything was sent to it.

    `code` is one of packages/egress's refusal reasons: metadata_endpoint,
    private_address, unresolvable_host, invalid_url.
    """

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _parse_ip(value: str):
    try:
        return ipaddress.ip_address(value.split("%", 1)[0])
    except ValueError:
        return None


def _unmap(address):
    """An IPv6 address carrying an IPv4 one, as that IPv4 address (address.ts `unmap`)."""
    if address.version != 6:
        return address
    packed = address.packed
    if any(packed[:8]):
        return address
    mapped = packed[8:10] == b"\0\0" and packed[10:12] == b"\xff\xff"
    compatible = packed[8:12] == b"\0\0\0\0"
    translated = packed[8:10] == b"\xff\xff" and packed[10:12] == b"\0\0"
    if mapped or compatible or translated:
        return ipaddress.IPv4Address(packed[12:])
    return address


def classify(ip: str) -> Category:
    """How the policy treats an address. An unparseable one is special: it fails closed."""
    parsed = _parse_ip(ip)
    if parsed is None:
        return "special"
    address = _unmap(parsed)
    if address in _METADATA_ADDRESSES:
        return "metadata"
    if any(address in network for network in _SPECIAL_NETWORKS):
        return "special"
    return "global"


def _bare_host(host: str) -> str:
    host = host.strip().lower()
    if host.startswith("[") and host.endswith("]"):
        host = host[1:-1]
    return host[:-1] if host.endswith(".") else host


@dataclass(frozen=True)
class EgressPolicy:
    """BLOCK_LOCAL_HTTP_CALLS refuses every non-public address; ALLOWED_PROXY_HOSTS
    names exact hosts let past that refusal. Neither ever admits cloud metadata."""

    block_local: bool
    allowed_hosts: frozenset[str]


def server_egress_policy() -> EgressPolicy:
    """The policy from the server's own environment, never from a request's env."""
    block = os.environ.get("BLOCK_LOCAL_HTTP_CALLS", "").strip().lower()
    allowed = os.environ.get("ALLOWED_PROXY_HOSTS", "")
    return EgressPolicy(
        block_local=block in ("1", "true"),
        allowed_hosts=frozenset(
            _bare_host(host) for host in allowed.split(",") if host.strip()
        ),
    )


# Captured once, so the pinned resolver below can always reach the real one.
_system_getaddrinfo = socket.getaddrinfo


def _addresses_of(host: str) -> tuple[str, ...]:
    """The literal address, or every address the name resolves to; empty if it does not."""
    if _parse_ip(host) is not None:
        return (host,)
    try:
        answers = _system_getaddrinfo(host, None, 0, socket.SOCK_STREAM)
    except (OSError, UnicodeError):
        return ()
    return tuple(dict.fromkeys(str(answer[4][0]) for answer in answers))


def _refuse_metadata() -> EgressDestinationRefusedError:
    return EgressDestinationRefusedError(
        "metadata_endpoint",
        "Access to cloud metadata endpoints is not allowed for security reasons",
    )


@dataclass(frozen=True)
class Destination:
    host: str
    addresses: tuple[str, ...]


@dataclass(frozen=True)
class Fence:
    """The policy one model call is judged by, plus the hosts the server itself chose.

    A server-chosen host is treated as allow-listed: its addresses are still
    resolved, refused if any is cloud metadata, and pinned.
    """

    policy: EgressPolicy
    admitted_hosts: frozenset[str] = frozenset()

    def judge_host(self, host: str) -> Destination:
        host = _bare_host(host)
        if host in _METADATA_HOSTS:
            raise _refuse_metadata()
        return self.judge_addresses(host, _addresses_of(host))

    def judge_addresses(self, host: str, addresses: tuple[str, ...]) -> Destination:
        """The addresses a name answered, judged for this fence's host."""
        if any(classify(address) == "metadata" for address in addresses):
            raise _refuse_metadata()
        allowed = host in self.policy.allowed_hosts or host in self.admitted_hosts
        if self.policy.block_local and not allowed:
            if any(classify(address) != "global" for address in addresses):
                raise EgressDestinationRefusedError(
                    "private_address",
                    f"The model endpoint host {host} is a private or local address, "
                    "which this deployment does not allow. An administrator can add "
                    "the exact host to ALLOWED_PROXY_HOSTS.",
                )
        return Destination(host=host, addresses=addresses)

    def judge_url(self, url: str) -> Destination:
        """A URL's host judged. A name that does not resolve is left to fail at connect."""
        try:
            parts = urlsplit(url)
            host = parts.hostname or ""
        except ValueError:
            parts, host = None, ""
        if parts is None or parts.scheme.lower() not in ("http", "https") or not host:
            raise EgressDestinationRefusedError(
                "invalid_url", "The model endpoint is not a valid http or https URL"
            )
        return self.judge_host(host)

    @contextmanager
    def active(self) -> Iterator[None]:
        token = _current_fence.set(self)
        try:
            yield
        finally:
            _current_fence.reset(token)


_current_fence: ContextVar[Optional[Fence]] = ContextVar(
    "langevals_egress_fence", default=None
)


def egress_refusal(
    exception: Optional[BaseException],
) -> Optional[EgressDestinationRefusedError]:
    """The refusal anywhere in an exception's chain, where client libraries wrap it."""
    seen: set[int] = set()
    while exception is not None and id(exception) not in seen:
        seen.add(id(exception))
        if isinstance(exception, EgressDestinationRefusedError):
            return exception
        exception = exception.__cause__ or exception.__context__
    return None


# Host -> [checked addresses, in-flight connections]. Every connection to a
# host in flight at once shares one answer, judged by each one's own fence.
_pins: dict[str, list] = {}
_pins_lock = threading.Lock()


@contextmanager
def _pinned(fence: Fence, destination: Destination) -> Iterator[None]:
    host = destination.host
    if _parse_ip(host) is not None:
        yield
        return
    with _pins_lock:
        entry = _pins.get(host)
        if entry is None:
            _pins[host] = [destination.addresses, 1]
        else:
            fence.judge_addresses(host, entry[0])
            entry[1] += 1
    try:
        yield
    finally:
        with _pins_lock:
            entry = _pins[host]
            entry[1] -= 1
            if entry[1] == 0:
                del _pins[host]


def _pinned_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
    """A pinned name answers with its checked addresses, so a second lookup cannot rebind it."""
    name = host.decode("ascii", "ignore") if isinstance(host, bytes) else host
    with _pins_lock:
        entry = _pins.get(_bare_host(name)) if isinstance(name, str) else None
        addresses = entry[0] if entry else None
    if addresses is None:
        return _system_getaddrinfo(host, port, family, type, proto, flags)
    answers = []
    for address in addresses:
        try:
            answers.extend(
                _system_getaddrinfo(
                    address, port, family, type, proto, flags | socket.AI_NUMERICHOST
                )
            )
        except socket.gaierror:
            continue
    if not answers:
        raise socket.gaierror(socket.EAI_NONAME, "no checked address for this family")
    return answers


@contextmanager
def _guarded(url: httpx.URL) -> Iterator[None]:
    """Judge one outgoing request under the active fence and pin its host while it connects."""
    fence = _current_fence.get()
    if fence is None:
        yield
        return
    destination = fence.judge_host(url.raw_host.decode("ascii"))
    if not destination.addresses:
        raise EgressDestinationRefusedError(
            "unresolvable_host",
            f"Could not resolve the model endpoint host {destination.host}",
        )
    with _pinned(fence, destination):
        yield


def fence_sync_transport(transport_class: type, method: str = "handle_request") -> None:
    original = transport_class.__dict__[method]
    if getattr(original, "_egress_fenced", False):
        return

    @wraps(original)
    def handle(self, request):
        with _guarded(request.url):
            return original(self, request)

    handle._egress_fenced = True  # type: ignore[attr-defined]
    setattr(transport_class, method, handle)


def fence_async_transport(
    transport_class: type, method: str = "handle_async_request"
) -> None:
    original = transport_class.__dict__[method]
    if getattr(original, "_egress_fenced", False):
        return

    @wraps(original)
    async def handle(self, request):
        with _guarded(request.url):
            return await original(self, request)

    handle._egress_fenced = True  # type: ignore[attr-defined]
    setattr(transport_class, method, handle)


def install_egress_fence() -> None:
    """Every httpx request under an active fence is judged and pinned. Idempotent."""
    socket.getaddrinfo = _pinned_getaddrinfo
    fence_sync_transport(httpx.HTTPTransport)
    fence_async_transport(httpx.AsyncHTTPTransport)
