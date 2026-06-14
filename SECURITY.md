# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in this project or the Clipia API, please
report it **privately** — do not open a public issue.

- Email: **security@clipia.ai**
- Or use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
  ("Report a vulnerability" button on the Security tab).

Please include:
- a description of the issue and its impact,
- steps to reproduce (proof-of-concept if possible),
- any relevant logs (with secrets redacted).

We aim to acknowledge reports within **3 business days** and to provide a remediation
timeline after triage. Please give us a reasonable window to fix the issue before any
public disclosure.

## Supported versions

The latest published release on npm / PyPI receives security fixes. Older versions are
not maintained — please upgrade.

## Handling your API key

- Your Clipia API key (`clipia_live_*` / `clipia_test_*`) is a **secret**. Never commit
  it to a repository, paste it into an issue, or share it in logs.
- Pass it via an environment variable (e.g. `CLIPIA_API_KEY`), never hard-code it.
- Use a `clipia_test_*` sandbox key for development and CI — it never spends credits.
- If a key is exposed, revoke it immediately in your Clipia settings and create a new one.

## Scope

This policy covers this SDK/connector repository and the public Clipia API
(`https://api.clipia.ai`). Thank you for helping keep Clipia users safe.
