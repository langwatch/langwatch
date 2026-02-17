Certainly! Below is a basic template for a `CONTRIBUTING.md` file that you can tailor to fit the specifics of your project and contribution process:

---

# Contributing to LangWatch

First off, thank you for considering contributing to LangWatch. It's people like you that make LangWatch such a great tool.

## Code of Conduct

At LangWatch, we are committed to fostering an open and welcoming environment. We expect everyone participating in the LangWatch community to offer respect and courtesy to other community members at all times.

- **Respectful Communication**: Always communicate professionally. In the case of any conflict, assume good intentions and seek understanding before jumping to conclusions.
- **Consideration**: Be considerate of others' perspectives and experiences. Suggestions and criticism are welcome but should be constructive and aimed at improving the project.
- **Inclusivity**: Strive for inclusivity and diversity. LangWatch welcomes contributions from everyone who shares our goals.
- **Ethical Conduct**: Uphold an exemplary standard of integrity in all your contributions and interactions.
- **Privacy**: Never publish others' private information, such as a physical or electronic address, without explicit permission

## I don't want to read this whole document!

We understand, here are the basics:

- **For minor fixes**: Open a pull request
- **For major changes**: Open an issue for discussion before proceeding
- **For suggestions**: Open an issue and name it as a `feature request`

Please note, all contributions should start with an issue first.

## System Requirements

- **RAM**: At least **8 GB** of RAM is required to run the development environment
- **Docker**: Docker Desktop (or equivalent) must be installed and running
- **Performance tips**:
  - Close unnecessary applications to free up memory when running the full dev environment
  - If builds or hot-reload feel slow, ensure Docker has enough memory allocated (Docker Desktop → Settings → Resources)
  - Use `pnpm dev` for the lightest development setup

## How Can I Contribute?

### Reporting Bugs and Suggesting Enhancements

Go to the [issues](https://github.com/langwatch/langwatch/issues) tab to report any bug or suggest features.

### Design Guidelines

Before implementing UI features, please review our [Design Guidelines](./docs/design/README.md). These guidelines ensure consistency across the LangWatch platform and include:

- Rounded corners and translucent overlay standards
- Component preferences (Drawer vs Dialog)
- Page layout patterns
- Code examples for common patterns

### Pull Requests

The process described here has several goals:

- Maintain LangWatch's quality
- Fix problems that are important to users
- Engage the community in working toward the best possible LangWatch

Here's how to propose a change:

1. Fork the repo and create your branch from `main`.
2. If you've added code that should be tested, add tests.
3. If you've changed APIs, update the documentation.
4. Ensure the test suite passes.
5. Make sure your code lints.
6. Issue that pull request!

### E2E Testing

If your changes affect the UI, please ensure e2e tests pass:

```bash
cd agentic-e2e-tests
docker compose up -d --wait
pnpm install && pnpm test
```

See `agentic-e2e-tests/README.md` for details on writing new tests.

## Commit Messages and PR Titles

We follow the [Conventional Commits](https://www.conventionalcommits.org) specification for our commit messages and PR titles. This helps us automate versioning and generate changelogs.

## Additional Notes

Please don't use the issue tracker for support questions. Check whether the [Docs](https://docs.langwatch.ai/) offer any help with your problem.

Thank you for reading through this CONTRIBUTING guide. We look forward to your contribution!
