# Contributing Guidelines

We welcome contributions! Before adding new functionality, open an issue first. Bug reports, fixes, and feedback are always appreciated.

Please take the time to review the [Code of Conduct](CODE_OF_CONDUCT.md), which all contributors are subject to on this project.

## Prerequisites

**Required:**
- **Node.js 24.0.0+**
- **pnpm 10.0.0+** (npm and yarn will NOT work due to security configurations)

**Installation:**
```bash
# Install pnpm globally if not already installed
npm install -g pnpm@10.0.0

# Install all dependencies (recommended)
pnpm run install:all

# Or install manually in two steps:
pnpm install                           # Install root dependencies
pnpm run install:frontend              # Install frontend dependencies
```

**Important:** This project uses strict security measures:
- All lifecycle scripts are disabled (`ignore-scripts=true`)
- Dependencies are pinned to exact versions
- Using npm or yarn will fail intentionally
- Frontend must be installed separately due to blocked postinstall scripts
- Use `install:all` helper script for convenience

## Reporting Bugs

Before submitting a bug report:
- Search existing issues and comment if one exists instead of creating a duplicate.

When submitting a bug report:
- Use a clear title
- List exact steps to reproduce the issue
- Provide examples, links, or code snippets
- Describe observed vs. expected behavior
- Include screenshots or GIFs
  - For macOS and Windows: [LICEcap](https://www.cockos.com/licecap/)
  - For Linux: [Silentcast](https://github.com/colinkeenan/silentcast)
- Mention if the issue is consistent or intermittent and share environment details

## Suggesting Enhancements

Before submitting an enhancement:
- Search existing suggestions and comment on one instead of creating a duplicate.

When submitting an enhancement:
- Use a clear title
- Describe the enhancement step-by-step
- Provide examples or code snippets
- Explain current vs. expected behavior and its benefits

## First Time Contributors

Check `beginner` and `help-wanted` issues to get started.

## Pull Requests

Please follow these steps:
1. Use the Pull Request template
2. Follow the [Code of Conduct](CODE_OF_CONDUCT.md)
3. Run security checks locally before submitting:
   ```bash
   pnpm run security-check:all
   ```
4. Ensure all [status checks](https://help.github.com/articles/about-status-checks/) pass before review
   - Security scanning (if configured) must pass
   - All dependencies must be pinned to exact versions
   - Lockfile changes must be committed if dependencies updated

Note: Reviewers may request additional changes before merging.

## Security Scanning

Pull requests with dependency updates should be scanned for security vulnerabilities using Snyk. Review the [Security Policy](SECURITY.md) for detailed information about our security practices.

## Questions?

Connect with us through any of these channels:
- [GitHub Discussions](https://github.com/orgs/deepgram/discussions)
- [Discord](https://discord.gg/deepgram)
- [Bluesky](https://bsky.app/profile/deepgram.com)

For additional guidance, check out [GitHub Flow](https://guides.github.com/introduction/flow/index.html).
