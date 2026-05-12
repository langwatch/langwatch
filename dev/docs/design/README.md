# LangWatch Design System

This documentation outlines the design principles and guidelines for the LangWatch platform UI. Following these guidelines ensures a consistent, modern, and professional user experience across all features.

## Quick Reference

| Principle | Key Points |
|-----------|------------|
| **Rounded Corners** | Use `borderRadius="lg"` for most elements |
| **Translucent Overlays** | `background="white/75"` + `backdropFilter="blur(8px)"` |
| **Prefer Drawers** | Use drawers for resource selection, creation, and editing |
| **Page Layout** | Full width, small title, action buttons top-right |
| **Collapsed Menu** | Use `compactMenu` for content-heavy pages |

## Documentation Structure

- **[README.md](./README.md)** - Overview and quick reference (this file)
- **[guidelines.md](./guidelines.md)** - Detailed design principles with visual examples
- **[components.md](./components.md)** - Component preferences and usage patterns
- **[examples.md](./examples.md)** - Code examples for common patterns

## Core Design Values

1. **Modern & Clean** - Rounded corners and translucent effects create a modern, approachable feel
2. **Consistent** - Same patterns applied across all pages and features
3. **Focused** - Collapsible navigation for content-heavy pages reduces cognitive load
4. **Intuitive** - Drawers provide context without losing page state

## Getting Started

When implementing a new feature or page:

1. Review the [guidelines](./guidelines.md) for design principles
2. Check [components](./components.md) for preferred component choices
3. Use code from [examples](./examples.md) as starting points
4. Follow the established patterns in existing pages

## Related Resources

- [PR #1025](https://github.com/langwatch/langwatch/pull/1025) - Original design implementation
- [Chakra UI v3 Documentation](https://chakra-ui.com/docs) - Component library reference
