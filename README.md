# dsh-jev-auto-approve

Jev-backed auto-approval for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`).

The plugin asks [TypeSafe Jev](https://typesafe.ai/) whether a pending approval
request is authorized and not destructive, and answers it with `allowed-once`
when the review passes. It does **not** change the session permission preset or
the sandbox. Actions the plugin does not approve still reach the normal human
prompt.

> **Experimental.** Jev is an external model and can be wrong or manipulated by
> text in tool arguments. Auto-approval is a convenience, not a security
> boundary. Read [SECURITY.md](SECURITY.md) before using it with sensitive work.

## Install

Install from npm:

```sh
dsh plugin --profile web add dsh-jev-auto-approve
```

Install directly from GitHub:

```sh
dsh plugin --profile web add github:Vultwo/dsh-jev-auto-approve
```

Or install the prebuilt release tarball:

```sh
dsh plugin --profile web add https://github.com/Vultwo/dsh-jev-auto-approve/releases/latest/download/dsh-jev-auto-approve.tgz
```

You can also open **Plugins -> Add plugin** in the Web UI and paste the GitHub
URL. After installation, enable the bundle if DSH asks.

Requirements: DSH `0.2.2-rc.1` (tested) and a TypeSafe API key. The plugin uses
Node 20.3+ APIs through DSH; it has no npm dependencies.

## Setup

1. Open **Plugins -> Jev auto-approve -> Configure**.
2. Paste the TypeSafe key into **API key** and click **Save key**.
3. Click **Test connection**. A successful test prints the Jev model and
   latency.
4. Run a task. The **Usage** card shows reviews, auto-approved calls, calls that
   asked a human, input/output tokens, estimated cost, and the last review.

The key is stored in the DSH credential store as `TYPESAFE_API_KEY`, not in the
profile patch, and the page never displays it again.

Fallbacks for headless or unattended use:

1. **Home file**: `printf '%s\n' 'YOUR_TYPESAFE_KEY' > ~/.dsh/jev-api-key && chmod 600 ~/.dsh/jev-api-key`
2. **Environment**: export `TYPESAFE_API_KEY` before launching DSH.
3. **Plugin config**: add `apiKey: YOUR_KEY` to the `jev-auto-approve` row in
   `cordis.patch.yml` (plaintext; only if you accept that tradeoff).

## Behavior

For each approval request the plugin sends Jev four calibrated yes/no
questions. Each one is a single narrow judgement: a `noul` over a conjunction of
conditions scores near its weakest conjunct, which makes the whole review
useless.

| Question | Meaning | Default gate |
|---|---|---|
| `destructive` | Executing the call would delete, truncate, or overwrite data that already existed and cannot be regenerated. | `<= 0.15` |
| `exfiltration` | The call sends file contents, environment variables, credentials, or tokens to a destination outside this machine. | `<= 0.10` |
| `security_mode` | The call changes the harness's permission or sandbox settings, its approval policy, or the agent's credentials. | `<= 0.20` |
| `authorized` | The user's own message authorizes this exact operation, target, and scope. | `>= 0.80` |

- Every gate passes -> the plugin answers `allowed-once`.
- Any gate fails, the key is missing, Jev errors, or the review times out -> the
  plugin delegates to the normal human approval prompt.
- `mode: shadow` logs what it would do but always delegates to the human.
- Read-only `plugin_manager` actions (`list_plugins`, `list_bundles`) take a deterministic fast path and are auto-approved without a Jev call. Set `allowReadOnlyPluginManager: false` to review them with Jev like every other action.

The policy is authorization-first. A call that destroys no pre-existing data,
exports nothing off the machine, and does not change the security posture is
approved when the user asked for it, including plugin installs and edits outside
the session workspace. The sandbox still governs what those operations can
reach; the plugin only decides who answers the approval prompt.

The review state carries the sandbox and approval policy the harness declared
for the session, so Jev can tell an escalation from a routine call.

The plugin reviews approval requests only. Ordinary workspace operations that
do not need approval are unaffected, and the plugin cannot override a `never`
approval policy.

## Configuration

The bundle is configured in `cordis.patch.yml`; the settings page edits the key
and shows usage. All fields are optional.

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch. |
| `mode` | `enforce` | `enforce` auto-approves; `shadow` only logs. |
| `baseURL` | `https://api.typesafe.ai/v1/systemone` | TypeSafe Jev endpoint. |
| `model` | `jev-latest` | Jev model id. |
| `apiKey` | empty | Fallback only; the settings page stores the key in the DSH credential store. |
| `apiKeyEnv` | `TYPESAFE_API_KEY` | Environment variable and credential reference fallback. |
| `apiKeyFile` | `~/.dsh/jev-api-key` | File fallback (one line, the key). |
| `timeoutMs` | `4000` | Per-review wall-clock budget. |
| `destructiveMax` | `0.15` | Maximum `destructive` probability. |
| `exfiltrationMax` | `0.10` | Maximum `exfiltration` probability. |
| `securityModeMax` | `0.20` | Maximum `security_mode` probability. |
| `authorizedThreshold` | `0.80` | Minimum `authorized` probability. |
| `includeUserMessage` | `true` | Include the user's own most recent message in the review state. |
| `allowReadOnlyPluginManager` | `true` | Auto-approve `plugin_manager` actions `list_plugins` and `list_bundles` without a Jev call. |
| `logFile` | `~/.dsh/jev-auto-approve.jsonl` | Append-only JSONL decision log. |

## Commands

| Command | Effect |
|---|---|
| `/jev-auto` | Show enabled/mode, key source, thresholds, counters, token totals, last review, log path. |
| `/jev-auto test` | Make one real Jev request to verify the key, endpoint, and model. |
| `/jev-auto on` / `/jev-auto off` | Toggle this process only. |
| `/jev-auto shadow` / `/jev-auto enforce` | Switch this process only. |

## What is sent to TypeSafe

The review state contains the tool name, the approval reason, the tool arguments
(up to 6000 characters), the working directory, the session's sandbox and
approval policy (up to 800 characters), and, unless `includeUserMessage` is
`false`, the user's own most recent message (up to 1200 characters). Injected
harness context, such as time samples, runtime snapshots and skill catalogues, is
not a user message and is skipped. No environment variables, credentials, or
full session history are sent. The key itself is sent only in the HTTP
`Authorization` header.

## Logs

Each decision appends one JSON line to `logFile`:

```json
{"ts":"2026-11-11T15:00:00.000Z","outcome":"allowed","tool":"bash","callId":"call_...","sessionId":"...","mode":"enforce","scores":{"destructive":0.03,"exfiltration":0.01,"security_mode":0.02,"authorized":0.91},"latencyMs":420,"reviewReason":"all thresholds met","keySource":"credentials:TYPESAFE_API_KEY","usage":{"inputTokens":501,"outputTokens":0,"costUsd":0.00002},"cwd":"/path/to/workspace"}
```

The log never contains the API key or the full tool arguments.

## Development

```sh
node --test test/*.test.mjs
```

The tests use a local mock Jev server; no key or network is needed. The CI
workflow runs the same tests on Node 24.

## License

MIT. See [LICENSE](LICENSE).
