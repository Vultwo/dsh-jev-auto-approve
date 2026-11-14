# Changelog

## 0.2.5

- Auto-approve read-only `plugin_manager` actions `list_plugins` and `list_bundles` without a Jev call; configurable with `allowReadOnlyPluginManager`.

## 0.2.4

- First npm release through staged publishing; no plugin behavior changes.
- Document the npm install command.

## 0.2.3

- Fix cold-start route registration by waiting for the `webServer` and
  `commands` services with `ctx.inject`.
- Use the TypeSafe `/v1/systemone` endpoint.
- Add the English settings page for the TypeSafe key and usage stats.
- Record input/output tokens and estimated cost from Jev responses.
- Add 16 unit and integration tests that run without a key or network.

## 0.1.0

- Initial approval-review plugin: three calibrated Jev questions, human
  fallback on any failure, credential-store key, `/jev-auto` command.
