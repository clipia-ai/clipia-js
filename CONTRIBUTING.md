# Contributing

Thanks for your interest in contributing to Clipia! This repo is part of the
[Clipia](https://clipia.ai) ecosystem — connect AI image & video generation to any
agent via the [Clipia MCP server](https://clipia.ai/mcp) and SDKs.

## Ways to contribute

- **Report bugs** — open an issue with steps to reproduce.
- **Suggest features** — open an issue describing the use case.
- **Submit a PR** — for fixes, docs, examples, or new client configs.

## Development setup

See the `README.md` in this repo for build/test commands. In short:

- **TypeScript SDK / CLI:** `npm install` → `npm run build` → `npm test`
- **Python SDK:** `pip install -e ".[dev]"` → `pytest`
- **MCP connector:** docs/config repo — no build; edit Markdown/JSON and validate examples.

Get a Clipia API key in your [settings](https://clipia.ai/settings). Use a
`clipia_test_*` **sandbox key** for development and CI — it returns instant mock
results and never spends credits.

## Pull request checklist

Before opening a PR, please make sure:

- [ ] CI is green (tests + secret scan).
- [ ] **No secrets** — no real API keys, tokens, passwords, or `.env` files. Use
      placeholders (`YOUR_API_KEY`) or clearly-fake test fixtures only.
- [ ] Commits are focused and the description explains the change.
- [ ] Docs/examples updated if behavior changed.

The PR template includes a short security checklist — please fill it in.

## Code style

- Follow the existing style in the repo (linters/formatters run in CI).
- Keep public API changes backward-compatible where possible; flag breaking changes clearly.

## Security

Found a vulnerability? **Do not open a public issue.** See [SECURITY.md](./SECURITY.md)
and report privately to **security@clipia.ai**. Never paste your API key anywhere public.

## License

By contributing, you agree that your contributions are licensed under the repository's
[MIT License](./LICENSE).
