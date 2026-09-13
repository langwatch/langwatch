# langwatch-ksuid

A modern, zero-dependency Python library for generating prefixed, k-sorted globally unique identifiers (KSUIDs).

[![PyPI Version](https://img.shields.io/pypi/v/langwatch-ksuid.svg?style=flat)](https://pypi.org/project/langwatch-ksuid/)
[![Build Status](https://img.shields.io/github/actions/workflow/status/langwatch/ksuid/ci.yml?branch=master)](https://github.com/langwatch/ksuid/actions)
[![Python](https://img.shields.io/badge/Python-3.8+-blue.svg)](https://www.python.org/)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](https://pypi.org/project/langwatch-ksuid/)

## Features

- ✅ **Zero Dependencies** - No external dependencies
- ✅ **Type Hints** - Full type annotation support
- ✅ **K-Sortable** - IDs are naturally sortable by creation time
- ✅ **Environment Aware** - Support for different environments (prod, dev, staging, etc.)
- ✅ **Instance Detection** - Automatic detection of Docker containers, MAC addresses, and PIDs

## Installation

```bash
pip install langwatch-ksuid
# or
uv add langwatch-ksuid
```

## Quick Start

### Basic Usage

```python
from ksuid import generate, parse

# Generate a KSUID
id = generate('user')
print(id)
# Output: user_00028U9MDT583X9eXPG1IU0ptdl1l

# Parse a KSUID
parsed = parse('user_00028U9MDT583X9eXPG1IU0ptdl1l')
print(parsed.resource)  # 'user'
print(parsed.environment)  # 'prod'
print(parsed.date)  # datetime object
```

### Environment-Specific IDs

```python
from ksuid import generate, set_environment

# Set environment
set_environment('dev')

# Generate dev-specific KSUID
dev_ksuid = generate('order')
print(dev_ksuid)
# Output: dev_order_00028U9MDT583X9eXPG1IU0ptdl1l
```

### Advanced Usage

```python
from ksuid import Ksuid, Instance, InstanceScheme
import time

# Create a custom instance
custom_instance = Instance(
    InstanceScheme.RANDOM,
    bytes([1, 2, 3, 4, 5, 6, 7, 8])
)

# Create KSUID manually
id = Ksuid(
    'prod',
    'product',
    int(time.time()),
    custom_instance,
    0
)

# Access KSUID properties
print(ksuid.timestamp)  # Unix timestamp
print(ksuid.sequence_id)  # Sequence number
print(ksuid.instance.scheme)  # Instance scheme
print(ksuid.to_json())  # Full JSON representation
```

## API Reference

### Main Functions

#### `generate(resource: str) -> Ksuid`
Generates a new KSUID for the specified resource.

```python
ksuid = generate('user')
```

#### `parse(input: str) -> Ksuid`
Parses a KSUID string and returns a Ksuid instance.

```python
ksuid = parse('user_00028U9MDT583X9eXPG1IU0ptdl1l')
```

### Environment Management

#### `get_environment() -> str`
Returns the current environment.

#### `set_environment(value: str) -> None`
Sets the current environment.

```python
set_environment('dev')
env = get_environment()  # 'dev'
```

### Instance Management

#### `get_instance() -> Instance`
Returns the current instance.

#### `set_instance(value: Instance) -> None`
Sets the current instance.

```python
instance = Instance(InstanceScheme.RANDOM, bytes(8))
set_instance(instance)
```

### Classes

#### `Ksuid`
The main KSUID class.

**Properties:**
- `environment: str` - The environment (prod, dev, etc.)
- `resource: str` - The resource type (user, order, etc.)
- `timestamp: int` - Unix timestamp
- `instance: Instance` - The instance identifier
- `sequence_id: int` - Sequence number
- `date: datetime` - Python datetime object

**Methods:**
- `__str__() -> str` - Returns the string representation
- `equals(other: Ksuid) -> bool` - Compares two KSUIDs
- `to_json() -> dict` - Returns JSON representation

#### `Instance`
Represents a machine/container instance.

**Schemes:**
- `InstanceScheme.RANDOM` - Random identifier
- `InstanceScheme.MAC_AND_PID` - MAC address + PID
- `InstanceScheme.DOCKER_CONT` - Docker container ID

#### `Node`
Advanced class for custom KSUID generation.

### Error Classes

- `ValidationError` - Thrown for validation failures
- `Base62Error` - Thrown for base62 encoding/decoding errors

## Platform Support

This library works in the following environments:

- **Python 3.8+** - Full support with automatic instance detection
- **Windows** - Uses MAC address + PID detection
- **macOS** - Uses MAC address + PID detection
- **Linux** - Uses Docker container ID or MAC address + PID detection

### Instance Detection

The library automatically detects the best instance identifier:

1. **Docker Containers** - Uses container ID (if available)
2. **Linux/macOS/Windows** - Uses MAC address + PID (if available)
3. **Fallback** - Uses cryptographically secure random bytes

## Development

### Setup

```bash
git clone https://github.com/langwatch/ksuid.git
cd ksuid/python
uv sync
```

### Scripts

```bash
uv run build      # Build the library
uv run test       # Run tests
uv run test:coverage # Run tests with coverage
uv run lint       # Run linting
uv run type-check # Type checking
```

### Testing

The library has comprehensive test coverage:

```bash
uv run test
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

## License

MIT License - see [LICENSE](../LICENSE) file for details.

## Acknowledgments

This library is inspired by the original [KSUID specification](https://github.com/segmentio/ksuid) and the [@cuvva/ksuid](https://github.com/cuvva/ksuid-node) implementation.
