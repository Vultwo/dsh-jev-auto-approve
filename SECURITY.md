# Security

## What this plugin does

`dsh-jev-auto-approve` runs inside the DeepSeek Harness Host process. For each
approval request it sends a review state to the configured TypeSafe Jev
endpoint and, when the review passes, answers the request with `allowed-once`.

The review state contains:

- the tool name;
- the approval reason;
- the tool arguments, truncated to 6000 characters;
- the session working directory;
- the most recent user message, truncated to 1200 characters, unless
  `includeUserMessage` is `false`.

It does not send environment variables, credential values, or the full session
history. The TypeSafe API key is sent only as the HTTP `Authorization` header.

## Key storage

The settings page stores the key in the DSH credential store under
`TYPESAFE_API_KEY`. The optional fallbacks are the `TYPESAFE_API_KEY`
environment variable, `~/.dsh/jev-api-key`, or a literal `apiKey` in the
plugin configuration. The decision log never contains the key.

## Local endpoints

The Host plugin registers two loopback-only routes:

- `GET /jev-auto/stats` returns aggregate usage counters and the last review.
- `POST /jev-auto/test` performs one Jev connection test using the stored key.

Both reject non-loopback socket addresses. They are not authenticated beyond
that check, so another local process can read the counters or trigger a test
call. They do not return the key or tool arguments.

## Trust boundary

Jev is an external model. It can return wrong answers or be influenced by
content in tool arguments. This plugin is not a sandbox, a security audit, or a
replacement for reviewing destructive actions. It only reduces approval prompts
for actions that pass its gates.

## Reporting

Report a vulnerability through GitHub's private security advisory for
`Vultwo/dsh-jev-auto-approve`, or email `ninokroesen@gmail.com`.
