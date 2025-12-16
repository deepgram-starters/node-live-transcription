# Security Policy

Deepgram's security policy can be found on our main website.

[Deepgram Security Policy](https://developers.deepgram.com/documentation/security/security-policy/)

## Supply Chain Security

This project implements comprehensive supply chain security measures to protect against vulnerabilities in dependencies.

### Package Manager Security

**pnpm 10.0.0+ is required** - this project will not work with npm or yarn.

Security configurations (`.npmrc`):
- `ignore-scripts=true` - All lifecycle scripts are disabled to prevent malicious code execution
- `enable-pre-post-scripts=false` - Pre/post install scripts are blocked
- `minimum-release-age=14400` - Packages must be 10+ days old before installation (4-hour minimum in minutes)
- `verify-store-integrity=true` - Package integrity hashes are verified
- `trust-policy=strict` - Strict trust policies enforced
- `strict-peer-dependencies=true` - Strict peer dependency resolution

### Dependency Pinning Strategy

All dependencies are pinned to exact versions (no `^` or `~` ranges) to ensure:
- Reproducible builds across all environments
- No unexpected updates that could introduce vulnerabilities
- Full control over dependency updates

### Snyk Integration

This project uses [Snyk](https://snyk.io) for continuous security monitoring:

**Local Security Checks:**
```bash
# Run security scan on root project
pnpm run security-check

# Run security scan on frontend
cd frontend && pnpm run security-check

# Scan all projects
pnpm run security-check:all
```

### Lockfile Protection

The `pnpm-lock.yaml` file is protected:
- CI uses `--frozen-lockfile` flag to prevent modifications
- Any lockfile changes must be committed explicitly
- Ensures consistency between development and production

### Reporting Security Issues

If you discover a security vulnerability in this project:

1. **Do NOT** open a public GitHub issue
2. Email security concerns to: security@deepgram.com
3. Include detailed information about the vulnerability
4. Allow reasonable time for response before public disclosure

We take security seriously and will respond promptly to legitimate security concerns.
