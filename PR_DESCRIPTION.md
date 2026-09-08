# feat: mint a Pangolin session for an external IdP user via the Integration API

## What

Adds an Integration-API endpoint that mints a Pangolin **user session token** for
an already-authenticated external identity:

```
POST /v1/org/:orgId/idp/:idpId/oidc/exchange-token
body:    { "userId": string }
returns: { "token": string, "expiresAt": number }
```

The token is a normal Pangolin user session token (identical to what the browser
OIDC callback produces), returned in the JSON body — the same delivery style as
`pollDeviceWebAuth`. No `Set-Cookie` is issued, because the caller here is a
backend, not a browser.

## Why

A trusted backend (the caller, cs-idp) that already holds a valid external IdP
session can bridge that session into Pangolin without driving the interactive
browser OIDC redirect flow. The external JWT is **not** sent to Pangolin.

The endpoint is **org-scoped** and guarded by **least privilege**: the caller
holds an **org-scoped** Fossorial API key granted **only** the `createIdpSession`
action, one org per deployment. Root access is unnecessary and too broad, so the
route uses the same org-scoped guard chain as the other `/org/:orgId/idp/:idpId`
integration routes rather than `verifyApiKeyIsRoot`. `verifyApiKeyIdpAccess`
additionally confirms the org actually owns the `:idpId`, so a key cannot mint
sessions against an IdP outside its org.

## Guards

Matches the existing `/org/:orgId/idp/:idpId/...` integration routes:

- `verifyApiKeyOrgAccess` — key has access to `:orgId`
- `verifyApiKeyIdpAccess` — `:orgId` owns `:idpId`
- `verifyApiKeyHasAction(ActionsEnum.createIdpSession)` (new action)
- `logActionAudit(ActionsEnum.createIdpSession)`

## New action

`createIdpSession` is added to `ActionsEnum` (`server/auth/actions.ts`). It is
auto-seeded into the DB and granted to admin roles by
`server/setup/ensureActions.ts` on startup (which early-returns on saas builds).

## saas gate

The route registration is wrapped in `if (build !== "saas") { … }`, so it exists
only on self-hosted (oss/enterprise) builds — following the precedent in
`server/routers/external.ts`.

## Out of scope (intentional)

This endpoint does **not** perform OIDC claim-mapping, role-mapping, or
autoprovision. Those require the live OIDC code/tokens (the ID-token claims),
which are not sent to this endpoint. The caller **must pre-provision the user**
(create the user under the IdP and add them to the org) before calling. The
helper enforces this: it verifies the user exists, that `users.idpId` matches the
`:idpId` in the path, and that a `userOrgs` membership row exists for `orgId`,
rejecting with `401`/`404` otherwise — mirroring the non-autoprovision rejection
branch in `server/routers/idp/validateOidcCallback.ts`.

## Operator step

Create an **org-scoped** API key for the target org and grant it **only** the
`createIdpSession` action. On self-hosted builds the action itself is seeded
automatically at startup.

Chicken-and-egg on the first grant: a freshly created key has **no** actions,
and the grant API (`POST /org/:orgId/api-key/:apiKeyId/actions`) is itself
gated by an action, so a fresh key can't grant itself its first action. Bootstrap
the first grant with a direct row insert into `apiKeyActions`
(`apiKeyId`, `actionId` for `createIdpSession`, `orgId`), after which the key can
call the exchange endpoint. (Alternatively perform the first grant with an
existing root/admin key.)

## curl example

```bash
curl -X POST \
  "https://<pangolin-host>/v1/org/myorg/idp/3/oidc/exchange-token" \
  -H "Authorization: Bearer <apiKeyId>.<secret>" \
  -H "Content-Type: application/json" \
  -d '{"userId":"abc123def456ghi"}'

# => { "token": "…", "expiresAt": 1737000000000 }
```

The returned `token` can then be set as the session cookie
(`<session_cookie_name>=<token>`) or used wherever a Pangolin user session token
is accepted.

## Files

- `server/auth/sessions/createSessionForIdpUser.ts` (new) — membership check +
  session mint helper.
- `server/routers/idp/createIdpSession.ts` (new) — Express handler with zod
  params/body validation.
- `server/routers/idp/index.ts` — export the new handler.
- `server/auth/actions.ts` — add `createIdpSession` to `ActionsEnum`.
- `server/routers/integration.ts` — register the guarded, saas-gated route.

## Note for reviewers

The two session-mint sites in `validateOidcCallback.ts` (autoprovision and
non-autoprovision branches) were **left untouched**. They could later be
de-duplicated onto `createSessionForIdpUser`, but that file is delicate (it also
sets the session cookie and computes branch-specific redirect URLs), so the
refactor was intentionally skipped to keep this PR low-risk.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
