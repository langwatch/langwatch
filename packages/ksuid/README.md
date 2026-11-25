# @langwatch/ksuid

A modern, zero-dependency TypeScript library for generating prefixed, k-sorted globally unique identifiers (KSUIDs).

[![NPM Version](https://img.shields.io/npm/v/@langwatch/ksuid.svg?style=flat)](https://www.npmjs.org/package/@langwatch/ksuid)
[![Build Status](https://img.shields.io/github/actions/workflow/status/langwatch/ksuid/ci.yml?branch=master)](https://github.com/langwatch/ksuid/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](https://www.npmjs.org/package/@langwatch/ksuid)

## Features

- ✅ **Zero Dependencies** - No external dependencies
- ✅ **TypeScript First** - Full TypeScript support with strict typing
- ✅ **Cross-Platform** - Works in Node.js, Browser, Bun, and Deno
- ✅ **K-Sortable** - IDs are naturally sortable by creation time
- ✅ **Environment Aware** - Support for different environments (prod, dev, staging, etc.)
- ✅ **Instance Detection** - Automatic detection of Docker containers, MAC addresses, and PIDs

## Installation

```bash
npm install @langwatch/ksuid
# or
yarn add @langwatch/ksuid
# or
pnpm add @langwatch/ksuid
```

## Quick Start

### Basic Usage

```typescript
import { generate, parse } from "@langwatch/ksuid";

// Generate a KSUID
const ksuid = generate("user");
console.log(ksuid.toString());
// Output: user_00028U9MDT583X9eXPG1IU0ptdl1l

// Parse a KSUID
const parsed = parse("user_00028U9MDT583X9eXPG1IU0ptdl1l");
console.log(parsed.resource); // 'user'
console.log(parsed.environment); // 'prod'
console.log(parsed.date); // Date object
```

### Environment-Specific IDs

```typescript
import { generate, setEnvironment } from "@langwatch/ksuid";

// Set environment
setEnvironment("dev");

// Generate dev-specific KSUID
const devKsuid = generate("order");
console.log(devKsuid.toString());
// Output: dev_order_00028U9MDT583X9eXPG1IU0ptdl1l
```

### Advanced Usage

```typescript
import { Ksuid, Instance, InstanceScheme } from "@langwatch/ksuid";

// Create a custom instance
const customInstance = new Instance(
  InstanceScheme.RANDOM,
  new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
);

// Create KSUID manually
const ksuid = new Ksuid("prod", "product", Math.floor(Date.now() / 1000), customInstance, 0);

// Access KSUID properties
console.log(ksuid.timestamp); // Unix timestamp
console.log(ksuid.sequenceId); // Sequence number
console.log(ksuid.instance.scheme); // Instance scheme
console.log(ksuid.toJSON()); // Full JSON representation
```

## API Reference

### Main Functions

#### `generate(resource: string): Ksuid`

Generates a new KSUID for the specified resource.

```typescript
const ksuid = generate("user");
```

#### `parse(input: string): Ksuid`

Parses a KSUID string and returns a Ksuid instance.

```typescript
const ksuid = parse("user_00028U9MDT583X9eXPG1IU0ptdl1l");
```

### Environment Management

#### `getEnvironment(): string`

Returns the current environment.

#### `setEnvironment(value: string): void`

Sets the current environment.

```typescript
setEnvironment("dev");
const env = getEnvironment(); // 'dev'
```

### Instance Management

#### `getInstance(): Instance`

Returns the current instance.

#### `setInstance(value: Instance): void`

Sets the current instance.

```typescript
const instance = new Instance(InstanceScheme.RANDOM, new Uint8Array(8));
setInstance(instance);
```

### Classes

#### `Ksuid`

The main KSUID class.

**Properties:**

- `environment: string` - The environment (prod, dev, etc.)
- `resource: string` - The resource type (user, order, etc.)
- `timestamp: number` - Unix timestamp
- `instance: Instance` - The instance identifier
- `sequenceId: number` - Sequence number
- `date: Date` - JavaScript Date object

**Methods:**

- `toString(): string` - Returns the string representation
- `equals(other: Ksuid): boolean` - Compares two KSUIDs
- `toJSON(): object` - Returns JSON representation

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

- **Node.js** (v18+) - Full support with automatic instance detection
- **Browser** - Uses Web Crypto API
- **Bun** - Native support
- **Deno** - Native support

### Instance Detection

The library automatically detects the best instance identifier:

1. **Docker Containers** - Uses container ID (if available)
2. **Node.js** - Uses MAC address + PID (if available)
3. **Fallback** - Uses cryptographically secure random bytes

## Development

### Setup

```bash
git clone https://github.com/langwatch/ksuid.git
cd ksuid
npm install
```

### Scripts

```bash
pnpm build         # Build the library
pnpm dev           # Watch mode for development
pnpm test          # Run tests
pnpm test:coverage # Run tests with coverage
pnpm lint          # Run ESLint
pnpm typecheck    # TypeScript type checking
```

### Testing

The library has comprehensive test coverage:

```bash
pnpm test
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
