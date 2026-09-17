# Repository Profile — `scrapper`

## Identity

- **Repository:** `appolon1908-hue/scrapper`
- **Category:** Legacy crawler lineage
- **Visibility:** `public`
- **Default branch:** `main`
- **Authority:** Historical implementation and migration evidence only; `kyqra-crawler` is canonical
- **Status:** Source-rich legacy crawler retained for parity, handoff, and rollback evidence; new production development is blocked here.

## Purpose

Preserves the historical multi-tenant business website crawler and CRM-enrichment implementation while the canonical runtime and future development move to `kyqra-crawler`.

## Owns

- Legacy crawler source lineage
- Historical API/contracts and migration evidence
- Source-parity and cutover records

## Does not own

- Future crawler runtime or job ledger
- A second crawler credential, queue, database, or deployment authority
- Direct writes to Odoo or other product databases

## Key integrations

- `kyqra-crawler`
- Kong
- Middleware
- n8n and Odoo through governed result events

## Current priorities

1. Keep the repository read-only except for migration and security evidence
2. Complete source/contract parity and rollback documentation
3. Preserve queue-drain, callback-cutover, and read-back evidence
4. Archive after the canonical migration and rollback window are accepted

## Governance and safety

- Follow `MISSION.md`: `main` is the only long-lived branch; use one temporary branch per phase and merge through a reviewed pull request.
- Use pull requests and exact-head/merge-result validation; merging source never authorizes deployment.
- Never commit secrets, credentials, private keys, customer data, database dumps, or secret-bearing evidence.
- Production images and releases must be immutable; mutable `latest` tags are not release authority.
- No new product capabilities, runtime deployment, provider access, or production traffic should be introduced here.
- This document does not deploy software, enable live effects, apply identity state, alter DNS/firewalls, reload Caddy, expose native ports, initialize OpenBao, or activate production.

## Account-wide catalog

See `appolon1908-hue/documentaions/REPOSITORY_CATALOG.md`.
