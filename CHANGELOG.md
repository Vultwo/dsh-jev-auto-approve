# Changelog

## 0.3.0

- **Fix: the user message was never sent to Jev.** The plugin read
  `event.data.message.content`, but DeepSeek Harness writes user text at
  `event.data.content`. `userMessage` was therefore always `null`, so the
  `authorized` question was answered against a state that contained no
  authorization evidence. Production reviews scored it 0.09 to 0.35 and none
  passed.
- Skip injected harness context when reading the message. Time samples, runtime
  snapshots and skill catalogues arrive as `user/message` events too; only
  `data.source.kind === "user"` came from the person typing. The scan also stops
  at the pending `tool/call`, so a later message cannot retroactively authorize
  it.
- Add `sandboxPolicy` to the review state: the `sandbox:policy` and
  `approval:policy` sections of the harness runtime-context snapshot, so Jev can
  tell an escalation from a routine call.
- **Replace the question set.** `safe` asked a single `noul` over six conjoined
  conditions, which scores near its weakest conjunct: it averaged 0.24 against a
  0.85 gate and blocked every review, including plain reads. It is replaced by
  `destructive`, `exfiltration` and `security_mode`, each one narrow judgement,
  alongside the unchanged `authorized`.
- **Policy change.** Authorization now carries the decision, guarded by three
  vetoes. A call is approved when it destroys no pre-existing data, exports
  nothing off the machine, keeps the security posture, and the user asked for it.
  This reverses the previous stance, where anything outside the session
  workspace reached a human regardless of authorization.
- Rename the threshold settings: `safeThreshold` and `irreversibleMax` are gone,
  replaced by `destructiveMax`, `exfiltrationMax` and `securityModeMax`. A
  profile that still sets the old keys falls back to the defaults.
- Test the session reader against real event shapes, including the regression
  case for the bug, and assert that the review state carries both the user
  message and the sandbox policy.

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
